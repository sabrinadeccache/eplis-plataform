import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeAudioDecodable } from "./probe";

// Fixtures REAIS e ADVERSARIAIS — ver a nota de proveniência em
// validate.test.ts pras 4 primeiras (geradas com ffmpeg). As 3 abaixo
// reproduzem, byte a byte, os dois ataques que a revisão do M2 (3ª rodada)
// demonstrou contra a validação anterior (baseada em ler estrutura/metadado
// do container em JS, sem decodificar nada de verdade):
//
//   # 540s reais de AAC, editando SÓ o campo de duração do `mvhd` pra
//   # declarar 2s (script Python que faz essa edição documentado aqui —
//   # não roda no teste, só pra reproduzir a fixture se precisar):
//   #   ffmpeg -f lavfi -i "sine=frequency=440:duration=540" -c:a aac \
//   #     -b:a 8k -ar 8000 -ac 1 valid-540s.mp4
//   #   (edita os 4 bytes do campo `duration` do mvhd pra 2*timescale)
//   forged-duration-2s.mp4
//
//   # MP4 válido (valid-2s.mp4) com o conteúdo do box `mdat` todo zerado —
//   # estrutura intacta (ftyp/moov/mdat do tamanho certo), payload inútil.
//   zeroed-mdat.mp4
//
//   # WebM válido (valid-2s.webm) com o conteúdo do Cluster (a partir do
//   # cabeçalho do Cluster) todo zerado.
//   zeroed-cluster.webm
const FIXTURES_DIR = join(__dirname, "fixtures");
function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

// ffmpeg real leva de ~50ms a alguns segundos por arquivo — generoso mas
// finito, pra não deixar o CI pendurado se algo travar.
const PROBE_TEST_TIMEOUT_MS = 20_000;

describe("probeAudioDecodable — decode real via ffmpeg, contra fixtures reais e adversariais", () => {
  it(
    "aceita e mede a duração real de um WebM finalizado",
    async () => {
      const result = await probeAudioDecodable(fixture("valid-2s.webm"), "webm");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.durationSeconds).toBeCloseTo(2, 0);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "aceita e mede a duração real de um WebM em stream (sem elemento Duration)",
    async () => {
      const result = await probeAudioDecodable(fixture("streaming-3s.webm"), "webm");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.durationSeconds).toBeCloseTo(3, 0);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "aceita e mede a duração real de um MP4/AAC",
    async () => {
      const result = await probeAudioDecodable(fixture("valid-2s.mp4"), "mp4");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.durationSeconds).toBeCloseTo(2, 0);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "mede a duração REAL (~540s) de um MP4 de 9 min de bitrate baixo em stream, não os bytes — achado exato da 2ª rodada da revisão",
    async () => {
      const result = await probeAudioDecodable(fixture("streaming-too-long-540s.webm"), "webm");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.durationSeconds).toBeGreaterThan(500);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "NÃO se deixa enganar pelo campo de duração forjado do mvhd — mede a duração REAL decodificada (540s, não os 2s declarados) — achado exato da 3ª rodada da revisão",
    async () => {
      const result = await probeAudioDecodable(fixture("forged-duration-2s.mp4"), "mp4");
      expect(result.ok).toBe(true);
      // O arquivo AFIRMA (no mvhd) ter 2 segundos — o decode real revela os
      // ~540s verdadeiros. Se isto desse ~2, o teto de duração continuaria
      // sendo burlável só editando metadado.
      if (result.ok) expect(result.durationSeconds).toBeGreaterThan(500);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita MP4 com mdat zerado (estrutura válida, payload inútil) — achado exato da 3ª rodada",
    async () => {
      const result = await probeAudioDecodable(fixture("zeroed-mdat.mp4"), "mp4");
      expect(result.ok).toBe(false);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita WebM com Cluster zerado (estrutura válida, payload inútil) — achado exato da 3ª rodada",
    async () => {
      const result = await probeAudioDecodable(fixture("zeroed-cluster.webm"), "webm");
      expect(result.ok).toBe(false);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    "rejeita conteúdo que não é áudio nenhum",
    async () => {
      const result = await probeAudioDecodable(Buffer.from("<html>não é áudio</html>"), "webm");
      expect(result.ok).toBe(false);
    },
    PROBE_TEST_TIMEOUT_MS,
  );
});
