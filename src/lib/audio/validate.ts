// Validação do áudio gravado pelo candidato ANTES de chamar Whisper/Claude —
// Milestone 2 do plano de correção (docs não versionados, ver
// docs/project-status.md → "Próximo passo"). Sem isso, qualquer usuário
// autenticado podia mandar um arquivo vazio, gigante, ou com MIME forjado
// direto pra rota de submit-response e gerar custo de IA (ou erro) sem
// nenhuma checagem.
//
// Os dois formatos reais que passam pela gravação do navegador
// (MediaRecorder) são WebM/Opus (Chrome/Firefox) e MP4/AAC (Safari) — mesmos
// dois que src/app/api/phase2/submit-response/route.ts e .../sdea/... já
// distinguem por `audio.type` pra escolher a extensão do upload. Aqui a
// checagem é mais forte: em vez de confiar no `Content-Type` que o navegador
// declarou (falsificável por quem chama a rota direto, fora do app), lê os
// bytes de assinatura reais do container.

export type AudioContainer = "webm" | "mp4";

// Teto de tamanho: acima disso não é resposta de entrevista (30-90s de fala
// comprimida em Opus/AAC fica bem abaixo de 5 MB) — é abuso/erro. Generoso o
// bastante pra não travar a Parte 4 do practice (história sem limite de
// tempo, já documentado em CLAUDE.md).
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB

// WebM/Matroska: cabeçalho EBML fixo. MP4/ISO-BMFF: os 4 bytes em 4..8 do
// arquivo são sempre "ftyp" (box type), independente da caixa 'size' inicial.
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const FTYP_MAGIC = Buffer.from("ftyp", "ascii");

// Assinatura real dos bytes, não a extensão nem o Content-Type declarado —
// só usa o header como pista de qual parser de duração tentar depois.
export function sniffAudioContainer(buffer: Buffer): AudioContainer | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(EBML_MAGIC)) {
    return "webm";
  }
  if (buffer.length >= 8 && buffer.subarray(4, 8).equals(FTYP_MAGIC)) {
    return "mp4";
  }
  return null;
}

function extFromMimeType(mimeType: string): AudioContainer {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

// Allowlist real do que o MediaRecorder do navegador produz (ver
// startRecording nos dois runners) — "audio/webm" (Chrome/Firefox, às vezes
// com ";codecs=opus") e "audio/mp4" (Safari). Qualquer outro Content-Type
// declarado é rejeitado aqui, antes até de olhar a extensão derivada.
const ALLOWED_MIME_PREFIXES = ["audio/webm", "audio/mp4"];

function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

// Duração do WebM/Matroska (bytes reais, não estimativa): procura o elemento
// EBML Duration (ID 0x4489, float) dentro de Segment > Info, junto do
// TimecodeScale (ID 0x2AD7B1, uint, em nanosegundos — default 1_000_000 =
// 1ms se ausente). Parser mínimo, não uma lib de Matroska completa: só sabe
// ler o tamanho de um elemento (VINT) e pular pelos containers até achar
// esses dois IDs.
//
// Limitação real e conhecida: o MediaRecorder do navegador grava um stream
// "ao vivo", não um arquivo com seek — a maioria dos blobs webm produzidos
// por ele NÃO escreve o elemento Duration (fica ausente, não "zero"). Então
// isto costuma devolver `null` em gravações reais do Chrome/Firefox — não é
// bug do parser. Por isso a duração nunca é o único guard: o teto de bytes
// (MAX_AUDIO_BYTES) é quem segura o caso comum; a duração exata só é
// exigida quando o container efetivamente a expõe (Safari/MP4, abaixo).
function readVint(buffer: Buffer, offset: number): { value: number; length: number } | null {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > buffer.length) return null;
  let value = first & (mask - 1);
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + buffer[offset + i];
  }
  return { value, length };
}

export function parseWebmDurationSeconds(buffer: Buffer): number | null {
  let timecodeScale = 1_000_000; // ns, default do spec Matroska
  let durationTicks: number | null = null;

  // Percorre o topo do arquivo procurando o Segment (0x18538067); dentro
  // dele, o Info (0x1549A966); dentro do Info, TimecodeScale e Duration.
  // Faz uma busca rasa (não recursiva) por assinatura de bytes em vez de um
  // parser EBML genérico — suficiente pro que precisamos e sem risco de
  // percorrer o arquivo inteiro (payload de áudio pode ter vários MB).
  const SEGMENT_ID = Buffer.from([0x18, 0x53, 0x80, 0x67]);
  const INFO_ID = Buffer.from([0x15, 0x49, 0xa6, 0x66]);
  const TIMECODE_SCALE_ID = Buffer.from([0x2a, 0xd7, 0xb1]);
  const DURATION_ID = Buffer.from([0x44, 0x89]);

  const segmentAt = buffer.indexOf(SEGMENT_ID);
  if (segmentAt === -1) return null;
  const infoAt = buffer.indexOf(INFO_ID, segmentAt);
  // Info costuma vir logo no início do Segment (antes dos Clusters, que são
  // grandes) — limita a busca a uma janela razoável pra não escanear áudio
  // binário inteiro em busca de uma sequência de bytes coincidente.
  if (infoAt === -1 || infoAt > segmentAt + 4096) return null;

  const searchEnd = Math.min(buffer.length, infoAt + 4096);
  const tsAt = buffer.indexOf(TIMECODE_SCALE_ID, infoAt);
  if (tsAt !== -1 && tsAt < searchEnd) {
    const sizeVint = readVint(buffer, tsAt + TIMECODE_SCALE_ID.length);
    if (sizeVint) {
      const dataStart = tsAt + TIMECODE_SCALE_ID.length + sizeVint.length;
      let value = 0;
      for (let i = 0; i < sizeVint.value && dataStart + i < buffer.length; i += 1) {
        value = value * 256 + buffer[dataStart + i];
      }
      if (value > 0) timecodeScale = value;
    }
  }

  const durAt = buffer.indexOf(DURATION_ID, infoAt);
  if (durAt !== -1 && durAt < searchEnd) {
    const sizeVint = readVint(buffer, durAt + DURATION_ID.length);
    if (sizeVint && (sizeVint.value === 4 || sizeVint.value === 8)) {
      const dataStart = durAt + DURATION_ID.length + sizeVint.length;
      if (dataStart + sizeVint.value <= buffer.length) {
        durationTicks =
          sizeVint.value === 4
            ? buffer.readFloatBE(dataStart)
            : buffer.readDoubleBE(dataStart);
      }
    }
  }

  if (durationTicks == null || !Number.isFinite(durationTicks) || durationTicks <= 0) return null;
  return (durationTicks * timecodeScale) / 1_000_000_000;
}

// Duração do MP4/ISO-BMFF: box `mvhd` dentro de `moov`, formato normalmente
// finalizado (ao contrário do WebM em stream) porque o gravador escreve o
// arquivo inteiro de uma vez ao parar — então isto costuma funcionar de
// verdade nos áudios do Safari. Versão 0 (32-bit) e versão 1 (64-bit) do
// `mvhd` têm layouts diferentes.
export function parseMp4DurationSeconds(buffer: Buffer): number | null {
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const boxSize = buffer.readUInt32BE(offset);
    const boxType = buffer.toString("ascii", offset + 4, offset + 8);
    if (boxSize < 8) break; // box malformado — não segue mais
    if (boxType === "moov") {
      return findMvhdDuration(buffer, offset + 8, Math.min(offset + boxSize, buffer.length));
    }
    offset += boxSize;
  }
  return null;
}

function findMvhdDuration(buffer: Buffer, start: number, end: number): number | null {
  let offset = start;
  while (offset + 8 <= end) {
    const boxSize = buffer.readUInt32BE(offset);
    const boxType = buffer.toString("ascii", offset + 4, offset + 8);
    if (boxSize < 8) break;
    if (boxType === "mvhd") {
      const version = buffer[offset + 8];
      if (version === 1) {
        const timescale = buffer.readUInt32BE(offset + 8 + 1 + 3 + 8 + 8);
        const duration = Number(buffer.readBigUInt64BE(offset + 8 + 1 + 3 + 8 + 8 + 4));
        return timescale > 0 ? duration / timescale : null;
      }
      const timescale = buffer.readUInt32BE(offset + 8 + 1 + 3 + 4 + 4);
      const duration = buffer.readUInt32BE(offset + 8 + 1 + 3 + 4 + 4 + 4);
      return timescale > 0 ? duration / timescale : null;
    }
    offset += boxSize;
  }
  return null;
}

export function getAudioDurationSeconds(buffer: Buffer, container: AudioContainer): number | null {
  try {
    return container === "mp4" ? parseMp4DurationSeconds(buffer) : parseWebmDurationSeconds(buffer);
  } catch {
    // Parser best-effort sobre bytes não confiáveis — qualquer índice fora
    // do array ou leitura inválida vira "não deu pra saber", nunca exceção.
    return null;
  }
}

// Teto de duração generoso o bastante pra cobrir a Parte 4 do practice (sem
// limite de tempo na gravação em si) sem travar uso legítimo — existe só
// pra rejeitar áudio absurdamente longo (ex.: um arquivo trocado de
// propósito). Só é aplicado quando a duração real foi extraída com sucesso
// (ver limitação do WebM documentada acima); quando não dá pra extrair, o
// teto de bytes é quem protege.
export const MAX_RESPONSE_DURATION_SECONDS = 8 * 60; // 8 min

export type AudioValidationResult =
  | { ok: true; container: AudioContainer; durationSeconds: number | null }
  | { ok: false; reason: string };

// Checagem completa, na ordem pedida pelo plano de correção: tamanho ->
// formato suportado -> assinatura real de conteúdo (não só extensão/MIME
// declarado) -> vazio/corrompido -> duração.
export function validateAudioUpload(buffer: Buffer, declaredMimeType: string): AudioValidationResult {
  if (buffer.length === 0) {
    return { ok: false, reason: "Áudio vazio." };
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    return { ok: false, reason: "Áudio maior que o limite permitido." };
  }

  if (!isAllowedMimeType(declaredMimeType)) {
    return { ok: false, reason: "Formato de áudio não suportado." };
  }
  const declaredExt = extFromMimeType(declaredMimeType);

  const sniffed = sniffAudioContainer(buffer);
  if (sniffed === null) {
    return { ok: false, reason: "Arquivo de áudio corrompido ou em formato não reconhecido." };
  }
  if (sniffed !== declaredExt) {
    // MIME declarado não bate com a assinatura real dos bytes — o
    // Content-Type de um multipart é livremente escolhido por quem manda a
    // requisição, então isto é a defesa real contra MIME forjado.
    return { ok: false, reason: "O conteúdo do arquivo não corresponde ao formato declarado." };
  }

  const durationSeconds = getAudioDurationSeconds(buffer, sniffed);
  if (durationSeconds != null && durationSeconds > MAX_RESPONSE_DURATION_SECONDS) {
    return { ok: false, reason: "Áudio mais longo que o limite permitido para uma resposta." };
  }

  return { ok: true, container: sniffed, durationSeconds };
}
