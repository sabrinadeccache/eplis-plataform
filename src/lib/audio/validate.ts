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

// Teto de duração de uma resposta — existe pra rejeitar áudio absurdamente
// longo (ex.: um arquivo trocado de propósito), generoso o bastante pra
// cobrir a Parte 4 do practice (história sem limite de tempo na gravação em
// si, já documentado em CLAUDE.md). Declarado ANTES do teto de bytes porque
// o teto de bytes é DERIVADO dele — ver comentário abaixo.
export const MAX_RESPONSE_DURATION_SECONDS = 8 * 60; // 8 min

// Teto de bytes — 1ª linha de defesa, barata, antes de decodificar
// qualquer coisa. **Não é mais o mecanismo que garante o teto de
// duração** (achado real da revisão de 2026-09-11: um arquivo de bitrate
// baixo cabe muito mais áudio no mesmo tamanho — quem garante a duração
// agora é a checagem de duração de verdade em `validateAudioUpload`, com
// fallback de timecode de Cluster pra quando o elemento Duration está
// ausente, ver `parseWebmDurationSeconds`). Calibrado a partir de um teto
// de BITRATE generoso (8 KB/s — bem acima de qualquer codec de voz real
// usado pelo MediaRecorder) vezes o teto de duração acima, e alinhado ao
// limite real de corpo de requisição das Vercel Functions (4,5 MB) — um
// teto maior que isso nunca seria alcançável em produção de qualquer
// forma (ver também src/app/api/*/submit-response/route.ts, que checa
// `Content-Length` ANTES de materializar o corpo).
const MAX_BITRATE_BYTES_PER_SECOND = 8 * 1024; // 8 KB/s
export const MAX_AUDIO_BYTES = MAX_BITRATE_BYTES_PER_SECOND * MAX_RESPONSE_DURATION_SECONDS; // ~3,75 MB

// Teto do CORPO DA REQUISIÇÃO inteiro (áudio + os outros campos do
// multipart + overhead de boundary) — checado via header `Content-Length`
// ANTES de ler o corpo (`assertContentLengthWithinLimit`,
// src/lib/simulations/item-guard.ts), pra nunca materializar em memória um
// payload que já sabemos que vai ser rejeitado. Folga pequena sobre
// `MAX_AUDIO_BYTES` só pros campos de texto/boundary do multipart.
export const MAX_REQUEST_BODY_BYTES = MAX_AUDIO_BYTES + 64 * 1024;

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

// Parser EBML mínimo, mas de verdade (navega pai -> filho por tamanho de
// elemento, nunca por busca de sequência de bytes solta). **Achado real da
// revisão (2026-09-11): a versão anterior usava `buffer.indexOf(ID)` pra
// achar Info/Tracks/Duration, e dava falso positivo dentro do `SeekHead`
// (0x114D9B74) — um elemento que TODO muxer real escreve, e que guarda os
// IDs de outros elementos como DADO BRUTO (não como elemento de verdade).
// Um WebM gerado por ffmpeg de propósito (fixture real, ver validate.test.ts)
// expôs isso: a busca por bytes achava o ID de "Info" dentro do SeekHead,
// antes do Info de verdade, e a duração real (correta, presente no arquivo)
// nunca era lida. Só navegar irmão-por-irmão a partir do tamanho declarado
// de cada elemento garante que nunca se interpreta dado de outro elemento
// como se fosse um elemento em si.
type EbmlElement = { id: number; dataStart: number; dataEnd: number };

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

// ID EBML: mesma codificação VINT, mas o valor final MANTÉM o bit
// marcador (convenção do spec — os IDs "canônicos" abaixo já incluem esse
// bit, ex.: Segment = 0x18538067). Só o tamanho (`readVint`) descarta o
// marcador.
function readElementId(buffer: Buffer, offset: number): { id: number; length: number } | null {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && !(first & mask)) {
    mask >>= 1;
    length += 1;
  }
  if (length > 4 || offset + length > buffer.length) return null;
  let id = 0;
  for (let i = 0; i < length; i += 1) {
    id = id * 256 + buffer[offset + i];
  }
  return { id, length };
}

// Lista os filhos DIRETOS de um elemento (entre `start` e `end`) — nunca
// desce recursivamente sozinho, quem chama decide se entra em um filho.
// Tamanho "desconhecido" (todos os bits de valor em 1 — comum em Segment/
// Cluster de streams ao vivo, sem seek pra voltar e gravar o tamanho real)
// faz o elemento se estender até `end`; como isso deixa a posição do
// PRÓXIMO irmão impossível de calcular, encerra a lista ali (é sempre o
// último filho relevante nesses dois casos específicos).
function readChildren(buffer: Buffer, start: number, end: number): EbmlElement[] {
  const children: EbmlElement[] = [];
  let offset = start;
  while (offset < end) {
    const idInfo = readElementId(buffer, offset);
    if (!idInfo) break;
    const sizeInfo = readVint(buffer, offset + idInfo.length);
    if (!sizeInfo) break;
    const dataStart = offset + idInfo.length + sizeInfo.length;
    const isUnknownSize = sizeInfo.value === 2 ** (7 * sizeInfo.length) - 1;
    const dataEnd = isUnknownSize ? end : Math.min(end, dataStart + sizeInfo.value);
    children.push({ id: idInfo.id, dataStart, dataEnd });
    if (isUnknownSize || dataEnd <= offset) break;
    offset = dataEnd;
  }
  return children;
}

function findChild(children: EbmlElement[], id: number): EbmlElement | undefined {
  return children.find((c) => c.id === id);
}

function readUintValue(buffer: Buffer, el: EbmlElement): number {
  let value = 0;
  for (let i = el.dataStart; i < el.dataEnd && i < buffer.length; i += 1) {
    value = value * 256 + buffer[i];
  }
  return value;
}

const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const TIMECODE_SCALE_ID = 0x2ad7b1;
const DURATION_ID = 0x4489;
const CLUSTER_ID = 0x1f43b675;
const CLUSTER_TIMECODE_ID = 0xe7;
const TRACKS_ID = 0x1654ae6b;
const TRACK_ENTRY_ID = 0xae;
const TRACK_TYPE_ID = 0x83;
const CODEC_ID_ID = 0x86;
const TRACK_TYPE_AUDIO = 2;
const AUDIO_CODEC_PREFIXES = ["A_OPUS", "A_VORBIS", "A_PCM"];

// Localiza o Segment navegando de verdade a partir da raiz — os únicos
// dois elementos de topo de um WebM/Matroska são o cabeçalho EBML (0) e o
// Segment (1), nessa ordem, então basta ler os filhos diretos da raiz.
function findSegment(buffer: Buffer): EbmlElement | undefined {
  const topLevel = readChildren(buffer, 0, buffer.length);
  return findChild(topLevel, SEGMENT_ID);
}

function getSegmentChildren(buffer: Buffer, segment: EbmlElement): EbmlElement[] {
  return readChildren(buffer, segment.dataStart, segment.dataEnd);
}

function readWebmTimecodeScaleAndDuration(
  buffer: Buffer,
  segmentChildren: EbmlElement[],
): { timecodeScale: number; durationTicks: number | null } {
  const DEFAULT_SCALE = 1_000_000; // ns, default do spec Matroska
  const info = findChild(segmentChildren, INFO_ID);
  if (!info) return { timecodeScale: DEFAULT_SCALE, durationTicks: null };

  const infoChildren = readChildren(buffer, info.dataStart, info.dataEnd);
  const tsEl = findChild(infoChildren, TIMECODE_SCALE_ID);
  const timecodeScale = tsEl ? readUintValue(buffer, tsEl) || DEFAULT_SCALE : DEFAULT_SCALE;

  const durEl = findChild(infoChildren, DURATION_ID);
  let durationTicks: number | null = null;
  if (durEl) {
    const size = durEl.dataEnd - durEl.dataStart;
    if (size === 4) durationTicks = buffer.readFloatBE(durEl.dataStart);
    else if (size === 8) durationTicks = buffer.readDoubleBE(durEl.dataStart);
    if (durationTicks != null && (!Number.isFinite(durationTicks) || durationTicks <= 0)) durationTicks = null;
  }

  return { timecodeScale, durationTicks };
}

// **Achado da revisão (2026-09-11): a duração precisa ser garantida mesmo
// quando o elemento Duration está ausente** — o caso comum e real do
// MediaRecorder do navegador (gravação em stream, sem seek pra voltar e
// escrever o header). Reproduzido de propósito com ffmpeg simulando esse
// exato cenário (saída não-seekável, `-f webm -` num pipe, ver
// validate.test.ts): o arquivo não tem elemento Duration, mas TEM um
// `Timecode` (0xE7) como primeiro filho de cada `Cluster` — obrigatório
// pelo spec Matroska, diferente de Duration, que é opcional. O timecode do
// ÚLTIMO Cluster já é, por construção, um limite INFERIOR confiável da
// duração real (o áudio continua depois desse ponto) — soma-se uma margem
// de segurança por cima (não por baixo) pra nunca deixar passar um arquivo
// que, somado o conteúdo do último cluster, ultrapassaria o teto.
const CLUSTER_DURATION_SAFETY_MARGIN_SECONDS = 30;

function findLastClusterTimecode(buffer: Buffer, segmentChildren: EbmlElement[]): number | null {
  let last: number | null = null;
  for (const child of segmentChildren) {
    if (child.id !== CLUSTER_ID) continue;
    const clusterChildren = readChildren(buffer, child.dataStart, child.dataEnd);
    const tcEl = findChild(clusterChildren, CLUSTER_TIMECODE_ID);
    if (!tcEl) continue;
    const value = readUintValue(buffer, tcEl);
    if (last == null || value > last) last = value;
  }
  return last;
}

export function parseWebmDurationSeconds(buffer: Buffer): number | null {
  const segment = findSegment(buffer);
  if (!segment) return null;
  const segmentChildren = getSegmentChildren(buffer, segment);

  const { timecodeScale, durationTicks } = readWebmTimecodeScaleAndDuration(buffer, segmentChildren);

  // 1. Elemento Duration, quando o arquivo foi finalizado (mais preciso).
  if (durationTicks != null) {
    return (durationTicks * timecodeScale) / 1_000_000_000;
  }

  // 2. Fallback: timecode do último Cluster + margem de segurança (arquivo
  // em stream, sem Duration — caso comum e real do MediaRecorder).
  const lastTimecode = findLastClusterTimecode(buffer, segmentChildren);
  if (lastTimecode == null) return null;
  const lastTimecodeSeconds = (lastTimecode * timecodeScale) / 1_000_000_000;
  return lastTimecodeSeconds + CLUSTER_DURATION_SAFETY_MARGIN_SECONDS;
}

// Duração do MP4/ISO-BMFF: box `mvhd` dentro de `moov`, formato normalmente
// finalizado (ao contrário do WebM em stream) porque o gravador escreve o
// arquivo inteiro de uma vez ao parar — então isto costuma funcionar de
// verdade nos áudios do Safari. Versão 0 (32-bit) e versão 1 (64-bit) do
// `mvhd` têm layouts diferentes. Formato de box simples (tamanho de 32 bits
// direto, sem VINT) — não sofre do mesmo problema de falso positivo do
// EBML, então a navegação por deslocamento sequencial aqui é segura.
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

// **Achado da revisão (2026-09-11): magic bytes sozinhos não provam que há
// áudio de verdade no arquivo** — um buffer com só o cabeçalho EBML seguido
// de zeros passava no `sniffAudioContainer` (assinatura bate) mesmo sem
// nenhum dado codificado. Isto verifica a ESTRUTURA mínima que um WebM
// real, gerado pelo MediaRecorder, sempre tem: um `Segment` contendo pelo
// menos um `Cluster` de verdade — é dentro do Cluster que o áudio
// codificado mora (`SimpleBlock`/`BlockGroup`) — E uma declaração de track
// de áudio (`Tracks` > `TrackEntry` com `TrackType` = áudio e um `CodecID`
// real). Não é uma prova de que os bytes do Cluster decodificam de fato
// (isso exigiria um decoder Opus de verdade, fora de escopo rodar num
// runtime serverless sem essa dependência) — mas fabricar Tracks + CodecID
// plausíveis JUNTO de um Cluster de tamanho real já não é "trocar 4 bytes
// de assinatura", é reproduzir a maior parte do container.
const MIN_CLUSTER_TAIL_BYTES = 16;

function hasWebmClusterPayload(segmentChildren: EbmlElement[]): boolean {
  return segmentChildren.some((c) => c.id === CLUSTER_ID && c.dataEnd - c.dataStart >= MIN_CLUSTER_TAIL_BYTES);
}

function hasWebmAudioTrack(buffer: Buffer, segmentChildren: EbmlElement[]): boolean {
  const tracks = findChild(segmentChildren, TRACKS_ID);
  if (!tracks) return false;
  const trackEntries = readChildren(buffer, tracks.dataStart, tracks.dataEnd).filter(
    (c) => c.id === TRACK_ENTRY_ID,
  );
  for (const entry of trackEntries) {
    const entryChildren = readChildren(buffer, entry.dataStart, entry.dataEnd);
    const typeEl = findChild(entryChildren, TRACK_TYPE_ID);
    if (!typeEl || readUintValue(buffer, typeEl) !== TRACK_TYPE_AUDIO) continue;
    const codecEl = findChild(entryChildren, CODEC_ID_ID);
    if (!codecEl) continue;
    const codecId = buffer.toString("ascii", codecEl.dataStart, codecEl.dataEnd);
    if (AUDIO_CODEC_PREFIXES.some((prefix) => codecId.startsWith(prefix))) return true;
  }
  return false;
}

export function hasWebmAudioPayload(buffer: Buffer): boolean {
  const segment = findSegment(buffer);
  if (!segment) return false;
  const segmentChildren = getSegmentChildren(buffer, segment);
  return hasWebmClusterPayload(segmentChildren) && hasWebmAudioTrack(buffer, segmentChildren);
}

// Equivalente pra MP4/ISO-BMFF: exige um box `mdat` (onde o áudio
// codificado de verdade fica) com tamanho de payload não-trivial — não só
// os boxes de metadado (`ftyp`/`moov`).
const MIN_MDAT_PAYLOAD_BYTES = 64;

function hasMp4MdatPayload(buffer: Buffer): boolean {
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const boxSize = buffer.readUInt32BE(offset);
    const boxType = buffer.toString("ascii", offset + 4, offset + 8);
    if (boxSize < 8) break;
    if (boxType === "mdat" && boxSize - 8 >= MIN_MDAT_PAYLOAD_BYTES) {
      return true;
    }
    offset += boxSize;
  }
  return false;
}

// Equivalente de hasWebmAudioTrack pro MP4: exige que `moov` declare uma
// sample entry de áudio real dentro de `stsd` (`mp4a` = AAC, o único que o
// MediaRecorder do Safari produz; `alac`/`sowt`/`twos` cobrem variações
// menos comuns de áudio não-comprimido). Mesma ressalva: não é uma prova
// de que o AAC decodifica de verdade, mas fecha o caso de só ter
// `ftyp`/`moov`/`mdat` de fachada sem nenhuma track declarada.
const AUDIO_SAMPLE_ENTRY_FOURCCS = ["mp4a", "alac", "sowt", "twos"];

function hasMp4AudioTrack(buffer: Buffer): boolean {
  return AUDIO_SAMPLE_ENTRY_FOURCCS.some((fourcc) => buffer.includes(Buffer.from(fourcc, "ascii")));
}

export function hasMp4AudioPayload(buffer: Buffer): boolean {
  return hasMp4MdatPayload(buffer) && hasMp4AudioTrack(buffer);
}

export function hasAudioPayload(buffer: Buffer, container: AudioContainer): boolean {
  try {
    return container === "mp4" ? hasMp4AudioPayload(buffer) : hasWebmAudioPayload(buffer);
  } catch {
    return false;
  }
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

export type AudioValidationResult =
  | { ok: true; container: AudioContainer; durationSeconds: number }
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

  if (!hasAudioPayload(buffer, sniffed)) {
    // Assinatura de container válida, mas sem Cluster (WebM) / mdat (MP4)
    // com payload de verdade — cabeçalho seguido de lixo/zeros, achado real
    // da revisão (ver hasWebmAudioPayload/hasMp4AudioPayload acima).
    return { ok: false, reason: "Arquivo de áudio corrompido ou em formato não reconhecido." };
  }

  // **Achado da revisão (2026-09-11): duração desconhecida não podia
  // continuar sendo aceita** — o teto de bytes sozinho não garante o teto
  // de duração (um arquivo de bitrate baixo cabe muito mais áudio no mesmo
  // tamanho). Com o fallback de timecode de Cluster acima
  // (`parseWebmDurationSeconds`), todo WebM real com pelo menos um Cluster
  // resulta em duração calculável — `null` agora só acontece pra um arquivo
  // genuinamente sem estrutura de tempo nenhuma, que é exatamente o que
  // devia ser rejeitado.
  const durationSeconds = getAudioDurationSeconds(buffer, sniffed);
  if (durationSeconds == null) {
    return { ok: false, reason: "Não foi possível determinar a duração do áudio." };
  }
  if (durationSeconds > MAX_RESPONSE_DURATION_SECONDS) {
    return { ok: false, reason: "Áudio mais longo que o limite permitido para uma resposta." };
  }

  return { ok: true, container: sniffed, durationSeconds };
}
