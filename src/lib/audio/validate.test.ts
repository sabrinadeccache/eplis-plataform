import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_AUDIO_BYTES,
  sniffAudioContainer,
  validateAudioContainer,
  validateDecodedAudio,
} from "./validate";

// Fixtures reais e adversariais — ver a nota de proveniência completa em
// src/lib/audio/probe.test.ts (que testa `probeAudioDecodable` isoladamente,
// com detalhe de como cada uma foi gerada).
//
// Esta suíte cobre a validação em DUAS etapas (separação feita na 4ª rodada
// da revisão, pro decode caro não rodar antes do rate limit/reserva de
// slot — ver comentário em validate.ts):
//   1. `validateAudioContainer` — síncrona, barata, sem decodificar nada.
//   2. `validateDecodedAudio` — roda o `ffmpeg` de verdade.
const FIXTURES_DIR = join(__dirname, "fixtures");
function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

const PROBE_TEST_TIMEOUT_MS = 20_000;

describe("sniffAudioContainer", () => {
  it("reconhece WebM pelo magic EBML (fixture real)", () => {
    expect(sniffAudioContainer(fixture("valid-2s.webm"))).toBe("webm");
  });

  it("reconhece MP4 pelo box ftyp (fixture real)", () => {
    expect(sniffAudioContainer(fixture("valid-2s.mp4"))).toBe("mp4");
  });

  it("devolve null pra bytes que não batem com nenhuma assinatura", () => {
    expect(sniffAudioContainer(Buffer.from("não é áudio nenhum"))).toBeNull();
  });

  it("devolve null pra buffer curto demais", () => {
    expect(sniffAudioContainer(Buffer.from([0x1a, 0x45]))).toBeNull();
  });
});

describe("validateAudioContainer (etapa barata, antes do rate limit/reserva)", () => {
  it("aceita as fixtures reais, devolvendo o container detectado", () => {
    expect(validateAudioContainer(fixture("valid-2s.webm"), "audio/webm")).toEqual({
      ok: true,
      container: "webm",
    });
    expect(validateAudioContainer(fixture("valid-2s.mp4"), "audio/mp4")).toEqual({
      ok: true,
      container: "mp4",
    });
  });

  it("rejeita arquivo vazio", () => {
    expect(validateAudioContainer(Buffer.alloc(0), "audio/webm")).toEqual({
      ok: false,
      reason: "Áudio vazio.",
    });
  });

  it("rejeita arquivo maior que o limite", () => {
    const big = Buffer.concat([fixture("valid-2s.webm"), Buffer.alloc(MAX_AUDIO_BYTES)]);
    expect(validateAudioContainer(big, "audio/webm").ok).toBe(false);
  });

  it("rejeita MIME declarado que não bate com a assinatura real dos bytes (spoofing)", () => {
    expect(validateAudioContainer(fixture("valid-2s.mp4"), "audio/webm")).toEqual({
      ok: false,
      reason: "O conteúdo do arquivo não corresponde ao formato declarado.",
    });
  });

  it("rejeita conteúdo que não é áudio nenhum, mesmo com MIME válido declarado", () => {
    expect(validateAudioContainer(Buffer.from("<html>não é áudio</html>"), "audio/webm")).toEqual({
      ok: false,
      reason: "Arquivo de áudio corrompido ou em formato não reconhecido.",
    });
  });

  it("rejeita formato de MIME não suportado", () => {
    expect(validateAudioContainer(fixture("valid-2s.webm"), "audio/x-whatever").ok).toBe(false);
  });

  it("NÃO decide nada sobre conteúdo decodificável — um MP4 só de vídeo passa nesta etapa (quem rejeita é o decode)", () => {
    // Documenta a divisão de responsabilidade de propósito: a assinatura
    // `ftyp` de um MP4 só de vídeo é indistinguível de um MP4 de áudio sem
    // decodificar. É `validateDecodedAudio` quem rejeita (ver abaixo).
    expect(validateAudioContainer(fixture("video-only.mp4"), "audio/mp4")).toEqual({
      ok: true,
      container: "mp4",
    });
  });
});

describe("validateDecodedAudio (decode real, depois da reserva de slot)", () => {
  it(
    "aceita as fixtures reais e decodificáveis, com a duração real medida",
    async () => {
      await expect(validateDecodedAudio(fixture("valid-2s.webm"), "webm")).resolves.toMatchObject({
        ok: true,
        container: "webm",
      });
      await expect(validateDecodedAudio(fixture("streaming-3s.webm"), "webm")).resolves.toMatchObject({
        ok: true,
        container: "webm",
      });
      await expect(validateDecodedAudio(fixture("valid-2s.mp4"), "mp4")).resolves.toMatchObject({
        ok: true,
        container: "mp4",
      });
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita a fixture real de bitrate baixo/9min mesmo cabendo no teto de bytes (duração real medida por decode)",
    async () => {
      const buf = fixture("streaming-too-long-540s.webm");
      expect(buf.length).toBeLessThan(MAX_AUDIO_BYTES);
      await expect(validateDecodedAudio(buf, "webm")).resolves.toEqual({
        ok: false,
        kind: "undecodable",
        reason: "Áudio mais longo que o limite permitido para uma resposta.",
      });
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita MP4 com duração forjada no mvhd (2s declarados, 540s reais) — usa a duração decodificada",
    async () => {
      await expect(validateDecodedAudio(fixture("forged-duration-2s.mp4"), "mp4")).resolves.toEqual({
        ok: false,
        kind: "undecodable",
        reason: "Áudio mais longo que o limite permitido para uma resposta.",
      });
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita payload zerado (mdat e Cluster) e corrupção parcial",
    async () => {
      await expect(validateDecodedAudio(fixture("zeroed-mdat.mp4"), "mp4")).resolves.toMatchObject({ ok: false });
      await expect(validateDecodedAudio(fixture("zeroed-cluster.webm"), "webm")).resolves.toMatchObject({
        ok: false,
      });
      await expect(validateDecodedAudio(fixture("partial-corruption-10s.mp4"), "mp4")).resolves.toMatchObject({
        ok: false,
      });
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita MP4 só de vídeo (sem faixa de áudio) — achado da 4ª rodada da revisão",
    async () => {
      await expect(validateDecodedAudio(fixture("video-only.mp4"), "mp4")).resolves.toMatchObject({ ok: false });
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "classifica arquivo ruim como `undecodable` (erro do candidato), nunca como `unavailable` — o 2º vira 503 na rota, não 422 (achado da homologação em produção)",
    async () => {
      const result = await validateDecodedAudio(fixture("zeroed-mdat.mp4"), "mp4");
      expect(result).toMatchObject({ ok: false, kind: "undecodable" });
    },
    PROBE_TEST_TIMEOUT_MS,
  );
});
