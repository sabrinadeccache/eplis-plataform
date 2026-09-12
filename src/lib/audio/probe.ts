// Validação de áudio por DECODE REAL — Milestone 2, 3ª rodada da revisão
// adversarial (ver docs/project-status.md). Toda a validação anterior
// (src/lib/audio/validate.ts: magic bytes, estrutura EBML/ISO-BMFF, Cluster/
// mdat, Tracks/CodecID) só olha o CONTAINER — e a Sabrina provou, com dois
// ataques reais, que isso nunca seria suficiente:
//
// 1. Duração mentirosa: um MP4 de 540s de verdade com o campo de duração do
//    `mvhd` editado pra declarar 2s — qualquer parser que leia só o
//    metadado do container (por mais correto que seja o parser) é enganado,
//    porque o metadado é exatamente o que foi forjado.
// 2. Payload zerado: um Cluster/mdat do tamanho certo mas com o conteúdo
//    codificado zerado — passa em qualquer checagem estrutural (tamanho,
//    presença de Track/CodecID), mas não decodifica nada de verdade.
//
// A única forma de fechar os dois é decodificar de verdade e medir o que
// saiu do decoder, não o que o container AFIRMA que tem. Isto roda o
// `ffmpeg` de verdade (via `ffmpeg-static`, binário estático empacotado —
// ver next.config.ts pro `outputFileTracingIncludes` que garante esse
// binário no bundle das duas route handlers de submit-response) contra um
// arquivo temporário, com `-progress pipe:1`: a duração que importa é o
// ÚLTIMO `out_time_us` que o próprio decodificador emite ao processar os
// samples reais — não um campo do container. Se o arquivo não decodifica
// (dados corrompidos, payload zerado, container forjado), o ffmpeg sai com
// erro e `probeAudioDecodable` rejeita.
//
// **Achados da 4ª rodada da revisão (2026-09-11), reproduzidos de verdade:**
// 3. Sem `-map 0:a`, o `ffmpeg` decodifica QUALQUER stream que o `-f null`
//    encontrar primeiro — um MP4 só de vídeo (sem faixa de áudio nenhuma)
//    era aceito, com a duração do VÍDEO reportada como se fosse áudio.
//    `-map 0:a -vn` restringe a decodificação só a streams de áudio e faz o
//    `ffmpeg` sair com erro se não houver nenhum.
// 4. Corrupção no MEIO do stream (zerar um trecho do payload, não o
//    arquivo inteiro) fazia o `ffmpeg` imprimir erros de decodificação no
//    stderr mas ainda assim sair com código 0 — só arquivos totalmente
//    irrecuperáveis quebravam o processo. `-xerror` faz o `ffmpeg` abortar
//    (código de saída != 0) no primeiro erro de decodificação, não só no
//    final.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

// Mensagem única pro caso "o validador não rodou" — a rota mapeia ela
// pra 503 (falha de servidor), nunca pra 422 (arquivo do candidato).
export const AUDIO_PROBE_UNAVAILABLE_REASON =
  "Não foi possível validar o áudio agora. Tente novamente em instantes.";

const PROBE_TIMEOUT_MS = 15_000;
// Corpo já é limitado por MAX_AUDIO_BYTES (validate.ts) antes de chegar
// aqui — folga generosa só pro texto de progresso/erro do próprio ffmpeg.
const MAX_FFMPEG_OUTPUT_BYTES = 4 * 1024 * 1024;

// `kind` separa DUAS falhas que não podem ser confundidas (achado da
// homologação em produção, 2026-09-12): "o arquivo que o candidato mandou
// não presta" (`undecodable`) e "o nosso validador não conseguiu rodar"
// (`unavailable` — binário do ffmpeg ausente/sem permissão, timeout,
// qualquer falha de spawn). A 1ª versão devolvia a mesma mensagem de
// "arquivo corrompido" pros dois casos: no 1º envio real em produção o
// ffmpeg nem executou, e a resposta dizia ao candidato que o áudio DELE
// estava corrompido — mascarando uma falha de infraestrutura como erro do
// usuário, e escondendo a causa de quem fosse investigar.
export type ProbeFailureKind = "undecodable" | "unavailable";
export type ProbeResult =
  | { ok: true; durationSeconds: number }
  | { ok: false; kind: ProbeFailureKind; reason: string };

// Erro de spawn (o processo nem chegou a rodar) tem `code` em STRING
// (ENOENT = binário não encontrado, EACCES/EPERM = sem bit de execução);
// erro de decodificação tem `code` NUMÉRICO (o exit code do ffmpeg).
function isSpawnFailure(error: unknown): boolean {
  const e = error as { code?: unknown; killed?: boolean } | null;
  if (!e) return false;
  if (e.killed) return true; // timeout — também é falha nossa, não do arquivo
  return typeof e.code === "string";
}

// `ffmpeg -progress pipe:1` emite periodicamente linhas `chave=valor` no
// stdout enquanto decodifica de verdade — `out_time_us` (microssegundos) é
// a posição real já processada pelo decoder. A ÚLTIMA ocorrência antes do
// processo terminar é a duração real decodificada. Versões antigas emitem
// `out_time_ms` em vez de `out_time_us` — cobre os dois.
function parseDecodedDurationSeconds(progressOutput: string): number | null {
  const usMatches = [...progressOutput.matchAll(/^out_time_us=(-?\d+)$/gm)];
  if (usMatches.length > 0) {
    const lastUs = Number(usMatches[usMatches.length - 1][1]);
    if (Number.isFinite(lastUs) && lastUs >= 0) return lastUs / 1_000_000;
  }
  const msMatches = [...progressOutput.matchAll(/^out_time_ms=(-?\d+)$/gm)];
  if (msMatches.length > 0) {
    const lastMs = Number(msMatches[msMatches.length - 1][1]);
    if (Number.isFinite(lastMs) && lastMs >= 0) return lastMs / 1000;
  }
  return null;
}

export async function probeAudioDecodable(buffer: Buffer, ext: "webm" | "mp4"): Promise<ProbeResult> {
  if (!ffmpegPath) {
    // Binário ausente pra essa plataforma/arquitetura — falha fechado (nunca
    // aceita sem decodificar de verdade).
    console.error("[audio-probe] ffmpeg-static não resolveu um caminho de binário nesta plataforma");
    return { ok: false, kind: "unavailable", reason: AUDIO_PROBE_UNAVAILABLE_REASON };
  }

  const ffmpegBinaryPath: string = ffmpegPath;
  const tmpPath = join(tmpdir(), `audio-probe-${randomBytes(8).toString("hex")}.${ext}`);
  await writeFile(tmpPath, buffer);

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        ffmpegBinaryPath,
        // -v error: silencia log verboso, mas erros reais (dados inválidos)
        // ainda aparecem no stderr.
        // -xerror: aborta com código de saída != 0 no PRIMEIRO erro de
        // decodificação — sem isso, corrupção no meio do stream (não o
        // arquivo inteiro) só gerava mensagens de erro no stderr, mas o
        // processo terminava com exit 0 mesmo assim.
        // -map 0:a -vn: decodifica só stream(s) de ÁUDIO — sem isto, um
        // arquivo sem nenhuma faixa de áudio (só vídeo) tinha a duração do
        // VÍDEO reportada como se fosse a duração do áudio. Com `-map 0:a`
        // e nenhum stream de áudio presente, o ffmpeg sai com erro.
        // -f null -: decodifica de verdade (precisa, pro null muxer poder
        // descartar frames) sem escrever arquivo de saída nenhum.
        ["-v", "error", "-xerror", "-i", tmpPath, "-map", "0:a", "-vn", "-progress", "pipe:1", "-f", "null", "-"],
        { timeout: PROBE_TIMEOUT_MS, maxBuffer: MAX_FFMPEG_OUTPUT_BYTES },
        (error: unknown, stdoutData: string) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdoutData);
        },
      );
    });

    const durationSeconds = parseDecodedDurationSeconds(stdout);
    if (durationSeconds == null) {
      return {
        ok: false,
        kind: "undecodable",
        reason: "Não foi possível determinar a duração real do áudio.",
      };
    }
    return { ok: true, durationSeconds };
  } catch (error) {
    if (isSpawnFailure(error)) {
      // O ffmpeg NÃO rodou (binário ausente/sem permissão, ou timeout). Não é
      // culpa do arquivo do candidato — loga o suficiente pra diagnosticar
      // (sem nada do conteúdo do áudio) e devolve uma falha de servidor.
      const e = error as { code?: unknown; errno?: unknown; syscall?: unknown; killed?: boolean };
      let binaryState = "desconhecido";
      try {
        const st = statSync(ffmpegBinaryPath);
        binaryState = `existe, mode=${(st.mode & 0o777).toString(8)}, ${st.size} bytes`;
      } catch {
        binaryState = "arquivo inexistente no caminho resolvido";
      }
      console.error(
        "[audio-probe] ffmpeg não pôde ser executado:",
        JSON.stringify({
          code: e.code,
          errno: e.errno,
          syscall: e.syscall,
          killed: e.killed ?? false,
          ffmpegBinaryPath,
          binaryState,
        }),
      );
      return { ok: false, kind: "unavailable", reason: AUDIO_PROBE_UNAVAILABLE_REASON };
    }
    // Exit code != 0 do próprio ffmpeg: dados inválidos, sem faixa de áudio,
    // corrupção parcial (-xerror) — aí sim é o arquivo.
    return { ok: false, kind: "undecodable", reason: "Arquivo de áudio corrompido ou não decodificável." };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
