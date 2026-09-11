import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_AUDIO_BYTES,
  MAX_RESPONSE_DURATION_SECONDS,
  hasMp4AudioPayload,
  hasWebmAudioPayload,
  parseMp4DurationSeconds,
  parseWebmDurationSeconds,
  sniffAudioContainer,
  validateAudioUpload,
} from "./validate";

// Fixtures REAIS (não bytes sintéticos), geradas com ffmpeg — ver
// `scripts/` não é o caso aqui, os arquivos já ficam versionados em
// src/lib/audio/fixtures/. Comando usado pra gerar cada um (documentado
// pra reproduzir/regenerar, não roda no teste):
//
//   ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -c:a libopus -b:a 24k valid-2s.webm
//   ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -c:a aac -b:a 24k valid-2s.mp4
//   ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -c:a libopus -b:a 24k -f webm - > streaming-3s.webm
//   ffmpeg -f lavfi -i "sine=frequency=440:duration=540" -c:a libopus -b:a 6k -f webm - > streaming-too-long-540s.webm
//
// `streaming-*` usa saída não-seekável (pipe) de propósito — é o único
// jeito de fazer o ffmpeg produzir um WebM SEM o elemento Duration
// finalizado, replicando o que o MediaRecorder do navegador realmente
// grava (achado da revisão de 2026-09-11: os testes anteriores só
// construíam bytes "parecidos" à mão, nunca validavam contra áudio de
// verdade, decodificável).
const FIXTURES_DIR = join(__dirname, "fixtures");
function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

// Constrói um Segment > Info > {TimecodeScale, Duration} + Tracks (com uma
// TrackEntry de áudio Opus) + Cluster mínimo o bastante pro parser/validador
// lerem — não é um WebM tocável de verdade (por isso as fixtures reais
// acima cobrem o caso decodificável), mas exercita os caminhos que dados
// sintéticos conseguem simular sem uma libopus por trás (ex.: um
// TimecodeScale não-default, ou a ausência proposital de um elemento).
function buildMinimalWebm(
  durationSeconds: number | null,
  {
    timecodeScaleNs = 1_000_000,
    withCluster = true,
    withTrack = true,
    clusterTimecode,
  }: { timecodeScaleNs?: number; withCluster?: boolean; withTrack?: boolean; clusterTimecode?: number } = {},
): Buffer {
  let info = Buffer.alloc(0);
  if (durationSeconds != null) {
    const durationTicks = (durationSeconds * 1_000_000_000) / timecodeScaleNs;
    const durationBytes = Buffer.alloc(8);
    durationBytes.writeDoubleBE(durationTicks, 0);

    const timecodeScaleBytes = Buffer.alloc(4);
    timecodeScaleBytes.writeUInt32BE(timecodeScaleNs, 0);

    info = Buffer.concat([
      Buffer.from([0x2a, 0xd7, 0xb1, 0x84]), // TimecodeScale ID + size=4 (VINT 0x84)
      timecodeScaleBytes,
      Buffer.from([0x44, 0x89, 0x88]), // Duration ID + size=8 (VINT 0x88)
      durationBytes,
    ]);
  } else if (timecodeScaleNs !== 1_000_000) {
    // Sem Duration, mas ainda precisamos declarar o TimecodeScale
    // não-default pro teste do fallback de Cluster respeitá-lo.
    const timecodeScaleBytes = Buffer.alloc(4);
    timecodeScaleBytes.writeUInt32BE(timecodeScaleNs, 0);
    info = Buffer.concat([Buffer.from([0x2a, 0xd7, 0xb1, 0x84]), timecodeScaleBytes]);
  }

  const infoElement =
    info.length > 0
      ? Buffer.concat([Buffer.from([0x15, 0x49, 0xa9, 0x66]), Buffer.from([0x80 | info.length]), info])
      : Buffer.alloc(0);

  // Tracks > TrackEntry > { TrackType=2 (áudio), CodecID="A_OPUS" }.
  let tracksElement = Buffer.alloc(0);
  if (withTrack) {
    const codecIdBytes = Buffer.from("A_OPUS", "ascii");
    const trackEntryBody = Buffer.concat([
      Buffer.from([0x83, 0x81, 0x02]), // TrackType ID + size=1 + value=2 (áudio)
      Buffer.from([0x86, 0x80 | codecIdBytes.length]), // CodecID ID + size
      codecIdBytes,
    ]);
    const trackEntry = Buffer.concat([Buffer.from([0xae, 0x80 | trackEntryBody.length]), trackEntryBody]);
    tracksElement = Buffer.concat([
      Buffer.from([0x16, 0x54, 0xae, 0x6b, 0x80 | trackEntry.length]),
      trackEntry,
    ]);
  }

  // Cluster real: ID + tamanho + Timecode (obrigatório, 1º filho) + um
  // "SimpleBlock" fake grande o bastante pra passar do piso mínimo.
  let cluster = Buffer.alloc(0);
  if (withCluster) {
    const tc = clusterTimecode ?? 0;
    const tcBytes: number[] = [];
    let remaining = tc;
    do {
      tcBytes.unshift(remaining & 0xff);
      remaining = Math.floor(remaining / 256);
    } while (remaining > 0);
    const timecodeElement = Buffer.concat([
      Buffer.from([0xe7, 0x80 | tcBytes.length]),
      Buffer.from(tcBytes),
    ]);
    const clusterBody = Buffer.concat([timecodeElement, Buffer.alloc(32, 0xab)]);
    cluster = Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0xff]), clusterBody]);
  }

  const segment = Buffer.concat([infoElement, tracksElement, cluster]);

  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // EBML magic (ID do elemento de cabeçalho)
    Buffer.from([0x84, 0x00, 0x00, 0x00, 0x00]), // size=4 (VINT) + 4 bytes de conteúdo dummy —
    // precisa ser um elemento EBML VÁLIDO agora (não só bytes soltos): o
    // parser novo (validate.ts, revisão de 2026-09-11) navega de verdade
    // pai->filho a partir do topo do arquivo, então o tamanho declarado do
    // cabeçalho EBML precisa bater com o que vem depois pra achar o
    // Segment na posição certa.
    Buffer.from([0x18, 0x53, 0x80, 0x67]), // Segment ID
    Buffer.from([0xff]), // size desconhecido (streaming) — real, testado contra a fixture streaming-*.webm
    segment,
  ]);
}

function buildMinimalMp4(
  durationSeconds: number,
  { timescale = 1000, withMdat = true, withAudioTrack = true }: { timescale?: number; withMdat?: boolean; withAudioTrack?: boolean } = {},
): Buffer {
  const mvhdBody = Buffer.alloc(100);
  mvhdBody[0] = 0; // version 0
  mvhdBody.writeUInt32BE(timescale, 1 + 3 + 4 + 4);
  mvhdBody.writeUInt32BE(Math.round(durationSeconds * timescale), 1 + 3 + 4 + 4 + 4);
  const mvhd = Buffer.concat([
    Buffer.alloc(4), // size placeholder, filled below
    Buffer.from("mvhd", "ascii"),
    mvhdBody,
  ]);
  mvhd.writeUInt32BE(mvhd.length, 0);

  const moovBody = mvhd;
  const moov = Buffer.concat([Buffer.alloc(4), Buffer.from("moov", "ascii"), moovBody]);
  moov.writeUInt32BE(moov.length, 0);

  const ftyp = Buffer.concat([
    Buffer.alloc(4),
    Buffer.from("ftyp", "ascii"),
    Buffer.from("isom", "ascii"),
  ]);
  ftyp.writeUInt32BE(ftyp.length, 0);

  // Box mínimo só pra carregar a fourcc "mp4a" (não é uma stsd real — o
  // validador só escaneia o buffer inteiro atrás dessa string).
  const audioTrackMarker = withAudioTrack ? Buffer.from([0, 0, 0, 8, ...Buffer.from("mp4a", "ascii")]) : Buffer.alloc(0);

  if (!withMdat) return Buffer.concat([ftyp, moov, audioTrackMarker]);

  const mdatPayload = Buffer.alloc(128, 0xcd); // "áudio codificado" fake, > MIN_MDAT_PAYLOAD_BYTES
  const mdat = Buffer.concat([Buffer.alloc(4), Buffer.from("mdat", "ascii"), mdatPayload]);
  mdat.writeUInt32BE(mdat.length, 0);

  return Buffer.concat([ftyp, moov, audioTrackMarker, mdat]);
}

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

describe("parseWebmDurationSeconds — fixtures reais (ffmpeg)", () => {
  it("lê a duração de um WebM finalizado (com elemento Duration)", () => {
    const seconds = parseWebmDurationSeconds(fixture("valid-2s.webm"));
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeCloseTo(2, 0);
  });

  it("estima a duração pelo timecode de Cluster quando NÃO há elemento Duration — caso real do MediaRecorder do navegador", () => {
    const buf = fixture("streaming-3s.webm");
    // Confirma a premissa do teste: esta fixture genuinamente não tem
    // elemento Duration (foi gerada com saída não-seekável de propósito).
    expect(buf.indexOf(Buffer.from([0x44, 0x89]))).toBe(-1);

    const seconds = parseWebmDurationSeconds(buf);
    expect(seconds).not.toBeNull();
    // Estimativa por Cluster tem a margem de segurança somada — fica acima
    // da duração real, nunca abaixo (ver comentário em validate.ts).
    expect(seconds!).toBeGreaterThanOrEqual(3);
    expect(seconds!).toBeLessThan(3 + 60);
  });

  it("estima corretamente uma gravação longa e de bitrate baixo (achado exato da revisão: bitrate baixo não escapa mais do teto)", () => {
    const buf = fixture("streaming-too-long-540s.webm");
    expect(buf.length).toBeLessThan(MAX_AUDIO_BYTES); // cabe dentro do teto de bytes...
    const seconds = parseWebmDurationSeconds(buf);
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeGreaterThan(MAX_RESPONSE_DURATION_SECONDS); // ...mas excede o de duração
  });

  it("respeita um TimecodeScale não-default (dado sintético)", () => {
    const buf = buildMinimalWebm(7, { timecodeScaleNs: 500_000 });
    expect(parseWebmDurationSeconds(buf)).toBeCloseTo(7, 3);
  });

  it("devolve null quando não há elemento Duration NEM Cluster nenhum", () => {
    expect(parseWebmDurationSeconds(buildMinimalWebm(null, { withCluster: false }))).toBeNull();
  });
});

describe("parseMp4DurationSeconds", () => {
  it("lê a duração real do mvhd de uma fixture gerada por ffmpeg", () => {
    const seconds = parseMp4DurationSeconds(fixture("valid-2s.mp4"));
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeCloseTo(2, 0);
  });

  it("lê a duração real do mvhd (version 0, dado sintético)", () => {
    const buf = buildMinimalMp4(12.3, { timescale: 1000 });
    expect(parseMp4DurationSeconds(buf)).toBeCloseTo(12.3, 1);
  });
});

describe("hasWebmAudioPayload / hasMp4AudioPayload", () => {
  it("aceita as fixtures reais (WebM finalizado, WebM em stream, MP4)", () => {
    expect(hasWebmAudioPayload(fixture("valid-2s.webm"))).toBe(true);
    expect(hasWebmAudioPayload(fixture("streaming-3s.webm"))).toBe(true);
    expect(hasMp4AudioPayload(fixture("valid-2s.mp4"))).toBe(true);
  });

  it("rejeita EBML seguido só de zeros (sem Segment/Cluster/Track nenhum)", () => {
    const ebmlPlusZeros = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
    expect(hasWebmAudioPayload(ebmlPlusZeros)).toBe(false);
  });

  it("rejeita WebM com Cluster real mas SEM nenhuma track de áudio declarada — achado da revisão", () => {
    const buf = buildMinimalWebm(10, { withTrack: false });
    expect(hasWebmAudioPayload(buf)).toBe(false);
  });

  it("rejeita WebM com Segment mas sem nenhum Cluster", () => {
    expect(hasWebmAudioPayload(buildMinimalWebm(10, { withCluster: false }))).toBe(false);
  });

  it("rejeita MP4 sem box mdat (só ftyp/moov)", () => {
    expect(hasMp4AudioPayload(buildMinimalMp4(10, { withMdat: false }))).toBe(false);
  });

  it("rejeita MP4 com mdat mas sem nenhuma sample entry de áudio declarada — achado da revisão", () => {
    const buf = buildMinimalMp4(10, { withAudioTrack: false });
    expect(hasMp4AudioPayload(buf)).toBe(false);
  });
});

describe("validateAudioUpload", () => {
  it("aceita as fixtures reais e decodificáveis (WebM finalizado, WebM em stream, MP4)", () => {
    expect(validateAudioUpload(fixture("valid-2s.webm"), "audio/webm")).toMatchObject({
      ok: true,
      container: "webm",
    });
    expect(validateAudioUpload(fixture("streaming-3s.webm"), "audio/webm")).toMatchObject({
      ok: true,
      container: "webm",
    });
    expect(validateAudioUpload(fixture("valid-2s.mp4"), "audio/mp4")).toMatchObject({
      ok: true,
      container: "mp4",
    });
  });

  it("rejeita a fixture real de bitrate baixo/9min mesmo cabendo no teto de bytes — achado exato da revisão", () => {
    const buf = fixture("streaming-too-long-540s.webm");
    expect(buf.length).toBeLessThan(MAX_AUDIO_BYTES);
    const result = validateAudioUpload(buf, "audio/webm");
    expect(result).toEqual({
      ok: false,
      reason: "Áudio mais longo que o limite permitido para uma resposta.",
    });
  });

  it("rejeita arquivo vazio", () => {
    const result = validateAudioUpload(Buffer.alloc(0), "audio/webm");
    expect(result).toEqual({ ok: false, reason: "Áudio vazio." });
  });

  it("rejeita arquivo maior que o limite", () => {
    const big = Buffer.concat([fixture("valid-2s.webm"), Buffer.alloc(MAX_AUDIO_BYTES)]);
    const result = validateAudioUpload(big, "audio/webm");
    expect(result.ok).toBe(false);
  });

  it("rejeita MIME declarado que não bate com a assinatura real dos bytes (spoofing)", () => {
    const result = validateAudioUpload(fixture("valid-2s.mp4"), "audio/webm");
    expect(result).toEqual({
      ok: false,
      reason: "O conteúdo do arquivo não corresponde ao formato declarado.",
    });
  });

  it("rejeita conteúdo que não é áudio nenhum, mesmo com MIME válido declarado", () => {
    const result = validateAudioUpload(Buffer.from("<html>não é áudio</html>"), "audio/webm");
    expect(result).toEqual({
      ok: false,
      reason: "Arquivo de áudio corrompido ou em formato não reconhecido.",
    });
  });

  it("rejeita WebM com assinatura válida mas sem Cluster (cabeçalho + zeros)", () => {
    const ebmlPlusZeros = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
    const result = validateAudioUpload(ebmlPlusZeros, "audio/webm");
    expect(result).toEqual({
      ok: false,
      reason: "Arquivo de áudio corrompido ou em formato não reconhecido.",
    });
  });

  it("rejeita WebM com Cluster real mas sem track de áudio declarada", () => {
    const result = validateAudioUpload(buildMinimalWebm(10, { withTrack: false }), "audio/webm");
    expect(result).toEqual({
      ok: false,
      reason: "Arquivo de áudio corrompido ou em formato não reconhecido.",
    });
  });

  it("rejeita MP4 com assinatura válida mas sem mdat com payload", () => {
    const result = validateAudioUpload(buildMinimalMp4(10, { withMdat: false }), "audio/mp4");
    expect(result).toEqual({
      ok: false,
      reason: "Arquivo de áudio corrompido ou em formato não reconhecido.",
    });
  });

  it("rejeita formato de MIME não suportado", () => {
    const result = validateAudioUpload(fixture("valid-2s.webm"), "audio/x-whatever");
    expect(result.ok).toBe(false);
  });

  it("rejeita duração acima do teto quando a duração real é extraível (fixture MP4 sintética)", () => {
    const tooLong = buildMinimalMp4(MAX_RESPONSE_DURATION_SECONDS + 60);
    const result = validateAudioUpload(tooLong, "audio/mp4");
    expect(result.ok).toBe(false);
  });

  it("rejeita WebM sem Duration E sem Cluster nenhum (duração indeterminável) — não é mais aceito por padrão", () => {
    const noDurationNoCluster = buildMinimalWebm(null, { withCluster: false, withTrack: false });
    const result = validateAudioUpload(noDurationNoCluster, "audio/webm");
    expect(result).toEqual({
      ok: false,
      reason: "Arquivo de áudio corrompido ou em formato não reconhecido.",
    });
  });
});
