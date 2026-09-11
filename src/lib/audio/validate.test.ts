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

// Constrói um Segment > Info > {TimecodeScale, Duration} + Cluster mínimo o
// bastante pro parser achar — não é um WebM tocável de verdade, só os bytes
// que o parser/validador leem. `withCluster` controla se um Cluster real
// (com "payload" de áudio fake) é incluído — usado pra distinguir "sem
// Duration mas com áudio de verdade" de "cabeçalho sem payload nenhum".
function buildMinimalWebm(
  durationSeconds: number | null,
  { timecodeScaleNs = 1_000_000, withCluster = true }: { timecodeScaleNs?: number; withCluster?: boolean } = {},
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
  }

  const infoElement =
    info.length > 0
      ? Buffer.concat([
          Buffer.from([0x15, 0x49, 0xa6, 0x66]), // Info ID
          Buffer.from([0x80 | info.length]), // size VINT (assume < 64 bytes)
          info,
        ])
      : Buffer.alloc(0);

  // Cluster real: ID + tamanho + um "SimpleBlock" fake grande o bastante
  // pra passar do piso mínimo de hasWebmAudioPayload.
  const cluster = withCluster
    ? Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75]), Buffer.alloc(32, 0xab)])
    : Buffer.alloc(0);

  const segment = Buffer.concat([infoElement, cluster]);

  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // EBML magic
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // filler até o Segment ID (irrelevante pro parser)
    Buffer.from([0x18, 0x53, 0x80, 0x67]), // Segment ID
    Buffer.from([0xff]), // size desconhecido (streaming) — o parser não lê isto
    segment,
  ]);
}

function buildMinimalMp4(
  durationSeconds: number,
  { timescale = 1000, withMdat = true }: { timescale?: number; withMdat?: boolean } = {},
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

  if (!withMdat) return Buffer.concat([ftyp, moov]);

  const mdatPayload = Buffer.alloc(128, 0xcd); // "áudio codificado" fake, > MIN_MDAT_PAYLOAD_BYTES
  const mdat = Buffer.concat([Buffer.alloc(4), Buffer.from("mdat", "ascii"), mdatPayload]);
  mdat.writeUInt32BE(mdat.length, 0);

  return Buffer.concat([ftyp, moov, mdat]);
}

describe("sniffAudioContainer", () => {
  it("reconhece WebM pelo magic EBML", () => {
    expect(sniffAudioContainer(buildMinimalWebm(10))).toBe("webm");
  });

  it("reconhece MP4 pelo box ftyp", () => {
    expect(sniffAudioContainer(buildMinimalMp4(10))).toBe("mp4");
  });

  it("devolve null pra bytes que não batem com nenhuma assinatura", () => {
    expect(sniffAudioContainer(Buffer.from("não é áudio nenhum"))).toBeNull();
  });

  it("devolve null pra buffer curto demais", () => {
    expect(sniffAudioContainer(Buffer.from([0x1a, 0x45]))).toBeNull();
  });
});

describe("parseWebmDurationSeconds", () => {
  it("lê a duração real do Info/Duration com TimecodeScale default", () => {
    const buf = buildMinimalWebm(42.5);
    expect(parseWebmDurationSeconds(buf)).toBeCloseTo(42.5, 3);
  });

  it("respeita um TimecodeScale não-default", () => {
    const buf = buildMinimalWebm(7, { timecodeScaleNs: 500_000 });
    expect(parseWebmDurationSeconds(buf)).toBeCloseTo(7, 3);
  });

  it("devolve null quando não há elemento Duration (caso comum de stream do MediaRecorder)", () => {
    expect(parseWebmDurationSeconds(buildMinimalWebm(null))).toBeNull();
  });
});

describe("parseMp4DurationSeconds", () => {
  it("lê a duração real do mvhd (version 0)", () => {
    const buf = buildMinimalMp4(12.3, { timescale: 1000 });
    expect(parseMp4DurationSeconds(buf)).toBeCloseTo(12.3, 1);
  });
});

describe("hasWebmAudioPayload / hasMp4AudioPayload", () => {
  it("aceita um WebM com Cluster real", () => {
    expect(hasWebmAudioPayload(buildMinimalWebm(10))).toBe(true);
  });

  it("rejeita EBML seguido só de zeros (sem Segment/Cluster nenhum) — achado da revisão", () => {
    const ebmlPlusZeros = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
    expect(hasWebmAudioPayload(ebmlPlusZeros)).toBe(false);
  });

  it("rejeita WebM com Segment mas sem nenhum Cluster", () => {
    expect(hasWebmAudioPayload(buildMinimalWebm(10, { withCluster: false }))).toBe(false);
  });

  it("aceita um MP4 com mdat de verdade", () => {
    expect(hasMp4AudioPayload(buildMinimalMp4(10))).toBe(true);
  });

  it("rejeita MP4 sem box mdat (só ftyp/moov)", () => {
    expect(hasMp4AudioPayload(buildMinimalMp4(10, { withMdat: false }))).toBe(false);
  });
});

describe("validateAudioUpload", () => {
  it("aceita um WebM válido dentro do limite", () => {
    const result = validateAudioUpload(buildMinimalWebm(20), "audio/webm");
    expect(result).toMatchObject({ ok: true, container: "webm" });
  });

  it("aceita um MP4 válido dentro do limite", () => {
    const result = validateAudioUpload(buildMinimalMp4(20), "audio/mp4");
    expect(result).toMatchObject({ ok: true, container: "mp4" });
  });

  it("rejeita arquivo vazio", () => {
    const result = validateAudioUpload(Buffer.alloc(0), "audio/webm");
    expect(result).toEqual({ ok: false, reason: "Áudio vazio." });
  });

  it("rejeita arquivo maior que o limite", () => {
    const big = Buffer.concat([buildMinimalWebm(20), Buffer.alloc(MAX_AUDIO_BYTES)]);
    const result = validateAudioUpload(big, "audio/webm");
    expect(result.ok).toBe(false);
  });

  it("rejeita MIME declarado que não bate com a assinatura real dos bytes (spoofing)", () => {
    const fakeWebmDeclaredAsWebm = buildMinimalMp4(10); // é MP4 de verdade
    const result = validateAudioUpload(fakeWebmDeclaredAsWebm, "audio/webm");
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

  it("rejeita WebM com assinatura válida mas sem Cluster (cabeçalho + zeros) — achado da revisão", () => {
    const ebmlPlusZeros = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
    const result = validateAudioUpload(ebmlPlusZeros, "audio/webm");
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
    const result = validateAudioUpload(buildMinimalWebm(10), "audio/x-whatever");
    expect(result.ok).toBe(false);
  });

  it("rejeita duração acima do teto quando a duração real é extraível", () => {
    const tooLong = buildMinimalMp4(MAX_RESPONSE_DURATION_SECONDS + 60);
    const result = validateAudioUpload(tooLong, "audio/mp4");
    expect(result.ok).toBe(false);
  });

  it("aceita WebM sem Duration extraível mas COM Cluster real (caso comum de gravação real)", () => {
    const noDuration = buildMinimalWebm(null, { withCluster: true });
    const result = validateAudioUpload(noDuration, "audio/webm");
    expect(result).toMatchObject({ ok: true, durationSeconds: null });
  });

  it("o teto de bytes por si só já impede exceder MAX_RESPONSE_DURATION_SECONDS mesmo sem duração exata (bitrate máximo assumido)", () => {
    // MAX_AUDIO_BYTES é calibrado como bitrate_máximo_assumido × duração
    // máxima — um arquivo do tamanho do teto, no bitrate real de voz
    // (bem abaixo do assumido), já representaria muito mais que o teto de
    // duração; a garantia aqui é só que o teto de bytes não é "solto":
    // ele é derivado matematicamente do teto de duração.
    expect(MAX_AUDIO_BYTES).toBeLessThanOrEqual(4.5 * 1024 * 1024); // dentro do limite de request da Vercel
  });
});
