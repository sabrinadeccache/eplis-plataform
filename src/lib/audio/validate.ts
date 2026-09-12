// Validação do áudio gravado pelo candidato ANTES de chamar Whisper/Claude —
// Milestone 2 do plano de correção (ver docs/project-status.md). Sem isso,
// qualquer usuário autenticado podia mandar um arquivo vazio, gigante, ou
// com MIME forjado direto pra rota de submit-response e gerar custo de IA
// (ou erro) sem nenhuma checagem.
//
// **Histórico da revisão (2026-09-11, 3ª rodada) — por que isto NÃO faz
// mais parsing de container em JS:** as duas primeiras rodadas tentaram
// validar duração e integridade lendo a estrutura do WebM/MP4 (elemento
// Duration, timecode de Cluster, presença de Tracks/CodecID/mdat). A
// Sabrina provou, com dois ataques reais, que isso nunca seria suficiente:
// (1) editar só o campo de duração do `mvhd` de um MP4 de 540s pra declarar
// 2s engana qualquer parser que leia METADADO do container, por mais
// correto que o parser seja — o metadado é exatamente o que foi forjado;
// (2) zerar o conteúdo codificado de um Cluster/mdat do tamanho certo passa
// em qualquer checagem estrutural (tamanho, presença de track), mas não
// decodifica nada. A conclusão, também dela: só decode real resolve isso.
// Ver src/lib/audio/probe.ts — usa `ffmpeg` de verdade (via `ffmpeg-static`)
// pra decodificar o arquivo e medir a duração pelo que o decoder realmente
// processou, não por nenhum campo do container.
//
// Os dois formatos reais que passam pela gravação do navegador
// (MediaRecorder) são WebM/Opus (Chrome/Firefox) e MP4/AAC (Safari) — mesmos
// dois que src/app/api/phase2/submit-response/route.ts e .../sdea/... já
// distinguem por `audio.type` pra escolher a extensão do upload.
import { probeAudioDecodable, type ProbeFailureKind } from "@/lib/audio/probe";

export type AudioContainer = "webm" | "mp4";

// Teto de duração de uma resposta — existe pra rejeitar áudio absurdamente
// longo (ex.: um arquivo trocado de propósito), generoso o bastante pra
// cobrir a Parte 4 do practice (história sem limite de tempo na gravação em
// si, já documentado em CLAUDE.md). Aplicado contra a duração REAL,
// decodificada por `probeAudioDecodable` — nunca contra metadado do
// container.
export const MAX_RESPONSE_DURATION_SECONDS = 8 * 60; // 8 min

// Teto de bytes — 1ª linha de defesa, barata, antes de decodificar
// qualquer coisa (rejeita payload gigante sem nem gastar o processo do
// ffmpeg). Calibrado a partir de um teto de BITRATE generoso (8 KB/s — bem
// acima de qualquer codec de voz real usado pelo MediaRecorder) vezes o
// teto de duração acima, e alinhado ao limite real de corpo de requisição
// das Vercel Functions (4,5 MB) — um teto maior que isso nunca seria
// alcançável em produção de qualquer forma (ver também
// src/app/api/*/submit-response/route.ts, que checa `Content-Length` ANTES
// de materializar o corpo).
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
// Usado só pra ESCOLHER a extensão do arquivo enviado ao storage/Whisper e
// decidir se o MIME declarado bate com o que está de fato ali — a validação
// de conteúdo em si (decodificável? qual a duração real?) é sempre do
// `probeAudioDecodable`, nunca desta assinatura.
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const FTYP_MAGIC = Buffer.from("ftyp", "ascii");

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

export type AudioContainerCheck =
  | { ok: true; container: AudioContainer }
  | { ok: false; reason: string };

export type AudioValidationResult =
  | { ok: true; container: AudioContainer; durationSeconds: number }
  // `kind` distingue "o arquivo do candidato não presta" (`undecodable`) de
  // "o nosso validador não conseguiu rodar" (`unavailable`) — a rota mapeia
  // o 2º pra 503, nunca pra 422. Ver src/lib/audio/probe.ts.
  | { ok: false; kind: ProbeFailureKind; reason: string };

// **Achado da revisão (2026-09-11, 4ª rodada): o decode real (ffmpeg) é caro
// e não pode rodar antes do rate limit / da reserva atômica de item** —
// antes, `validateAudioUpload` fazia tudo (barato + decode) numa função só,
// chamada ANTES de `assertSubmissionRate`/`reserveResponseSlot`; requisições
// concorrentes conseguiam disparar processos de decodificação livremente, e
// um arquivo inválido nunca chegava a criar/tocar uma linha de resposta —
// então não consumia `retry_count`, permitindo tentativas caras ilimitadas
// (só a autenticação limitava). Por isso esta validação foi separada em
// DUAS etapas, chamadas em pontos diferentes da rota:
//
// 1. `validateAudioContainer` (esta função, síncrona e barata) — ANTES do
//    rate limit e da reserva de slot. Tamanho, MIME numa allowlist,
//    assinatura real dos bytes. Nunca decodifica nada.
// 2. `validateDecodedAudio` (abaixo, assíncrona) — DEPOIS que o slot já foi
//    reservado (`reserveResponseSlot`, item-guard.ts). Só roda o `ffmpeg` de
//    verdade (`probeAudioDecodable`) pra quem já passou pela reserva —
//    então um arquivo inválido AGORA consome a linha reservada (o guard
//    marca `processing_status = 'error'`), contando pro teto de retry por
//    slot (`MAX_RETRIES_PER_SLOT`) como qualquer outra falha.
//
// Ver src/app/api/phase2/submit-response/route.ts e .../sdea/... pra ver a
// ordem completa: Content-Length -> auth -> validateAudioContainer ->
// rate limit -> guard de item/reserva de slot -> SÓ ENTÃO validateDecodedAudio.
export function validateAudioContainer(buffer: Buffer, declaredMimeType: string): AudioContainerCheck {
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

  return { ok: true, container: sniffed };
}

// Decodificação real (integridade + duração) — a única etapa que
// efetivamente prova que existe áudio decodificável, ver
// src/lib/audio/probe.ts. Chamar só DEPOIS de `reserveResponseSlot` ter
// reservado a linha (ver comentário acima).
export async function validateDecodedAudio(buffer: Buffer, container: AudioContainer): Promise<AudioValidationResult> {
  const probe = await probeAudioDecodable(buffer, container);
  if (!probe.ok) {
    return { ok: false, kind: probe.kind, reason: probe.reason };
  }
  if (probe.durationSeconds > MAX_RESPONSE_DURATION_SECONDS) {
    return {
      ok: false,
      kind: "undecodable",
      reason: "Áudio mais longo que o limite permitido para uma resposta.",
    };
  }

  return { ok: true, container, durationSeconds: probe.durationSeconds };
}
