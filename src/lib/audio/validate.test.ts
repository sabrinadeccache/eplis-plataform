import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_AUDIO_BYTES, sniffAudioContainer, validateAudioUpload } from "./validate";

// Fixtures reais e adversariais — ver a nota de proveniência completa em
// src/lib/audio/probe.test.ts (que testa `probeAudioDecodable` isoladamente,
// com mais detalhe sobre como cada uma foi gerada). Aqui o foco é a função
// de mais alto nível (`validateAudioUpload`): tamanho/MIME/assinatura antes
// do decode, e o decode real como decisão final.
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

describe("validateAudioUpload", () => {
  it(
    "aceita as fixtures reais e decodificáveis (WebM finalizado, WebM em stream, MP4)",
    async () => {
      await expect(validateAudioUpload(fixture("valid-2s.webm"), "audio/webm")).resolves.toMatchObject({
        ok: true,
        container: "webm",
      });
      await expect(validateAudioUpload(fixture("streaming-3s.webm"), "audio/webm")).resolves.toMatchObject({
        ok: true,
        container: "webm",
      });
      await expect(validateAudioUpload(fixture("valid-2s.mp4"), "audio/mp4")).resolves.toMatchObject({
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
      const result = await validateAudioUpload(buf, "audio/webm");
      expect(result).toEqual({
        ok: false,
        reason: "Áudio mais longo que o limite permitido para uma resposta.",
      });
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita um MP4 com o campo de duração do mvhd forjado (2s declarados, 540s reais) — a duração usada é a decodificada, não a do metadado (achado da 3ª rodada da revisão)",
    async () => {
      const result = await validateAudioUpload(fixture("forged-duration-2s.mp4"), "audio/mp4");
      expect(result).toEqual({
        ok: false,
        reason: "Áudio mais longo que o limite permitido para uma resposta.",
      });
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita MP4 com mdat zerado (estrutura de container válida, payload não decodifica) — achado da 3ª rodada",
    async () => {
      const result = await validateAudioUpload(fixture("zeroed-mdat.mp4"), "audio/mp4");
      expect(result.ok).toBe(false);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita WebM com Cluster zerado (estrutura de container válida, payload não decodifica) — achado da 3ª rodada",
    async () => {
      const result = await validateAudioUpload(fixture("zeroed-cluster.webm"), "audio/webm");
      expect(result.ok).toBe(false);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it("rejeita arquivo vazio (nem chega a decodificar)", async () => {
    const result = await validateAudioUpload(Buffer.alloc(0), "audio/webm");
    expect(result).toEqual({ ok: false, reason: "Áudio vazio." });
  });

  it("rejeita arquivo maior que o limite (nem chega a decodificar)", async () => {
    const big = Buffer.concat([fixture("valid-2s.webm"), Buffer.alloc(MAX_AUDIO_BYTES)]);
    const result = await validateAudioUpload(big, "audio/webm");
    expect(result.ok).toBe(false);
  });

  it("rejeita MIME declarado que não bate com a assinatura real dos bytes (spoofing) — nem chega a decodificar", async () => {
    const result = await validateAudioUpload(fixture("valid-2s.mp4"), "audio/webm");
    expect(result).toEqual({
      ok: false,
      reason: "O conteúdo do arquivo não corresponde ao formato declarado.",
    });
  });

  it("rejeita conteúdo que não é áudio nenhum, mesmo com MIME válido declarado — nem chega a decodificar", async () => {
    const result = await validateAudioUpload(Buffer.from("<html>não é áudio</html>"), "audio/webm");
    expect(result).toEqual({
      ok: false,
      reason: "Arquivo de áudio corrompido ou em formato não reconhecido.",
    });
  });

  it("rejeita formato de MIME não suportado", async () => {
    const result = await validateAudioUpload(fixture("valid-2s.webm"), "audio/x-whatever");
    expect(result.ok).toBe(false);
  });

});
