import { describe, expect, it, vi, beforeEach } from "vitest";

// Mesmo padrão de src/app/api/phase2/submit-response/route.test.ts — mocka
// na fronteira de cada responsabilidade (a lógica interna de
// `reserveResponseSlot`/`validateAudioContainer`/`validateDecodedAudio` já é coberta em seus próprios
// testes). Foco aqui é o fluxo da rota do piloto/SDEA, incluindo o caso
// específico da Parte 4 que reusa o mesmo `response_stage` duas vezes.

const authorize = vi.fn();
vi.mock("@/lib/auth/authorize", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, authorize };
});

const assertOwnAttemptInProgress = vi.fn();
vi.mock("@/services/simulations/pilot/actions", () => ({ assertOwnAttemptInProgress }));

const getSequenceForAttempt = vi.fn();
vi.mock("@/services/simulations/pilot/queries", () => ({ getSequenceForAttempt }));

const validateAudioContainer = vi.fn();
const validateDecodedAudio = vi.fn();
vi.mock("@/lib/audio/validate", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, validateAudioContainer, validateDecodedAudio };
});

const reserveResponseSlot = vi.fn();
vi.mock("@/lib/simulations/item-guard", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, reserveResponseSlot };
});

const assertSubmissionRate = vi.fn();
vi.mock("@/lib/simulations/rate-limit", () => ({ assertSubmissionRate }));

const getConsentStatus = vi.fn();
vi.mock("@/lib/simulations/consent", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, getConsentStatus };
});

const transcribeAudio = vi.fn();
vi.mock("@/lib/ai/openai", () => ({ transcribeAudio }));

const generatePilotResponseFeedback = vi.fn();
vi.mock("@/lib/ai/pilot-track", () => ({
  generatePilotResponseFeedback,
  MODEL_VERSION: "test-model",
}));

const storageUpload = vi.fn();
const adminUpdate = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      return {
        update(payload: Record<string, unknown>) {
          adminUpdate(payload);
          return this;
        },
        eq() {
          return this;
        },
        then(resolve: (v: { data: null; error: null }) => void) {
          resolve({ data: null, error: null });
        },
      };
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: {
      from() {
        return {
          upload: storageUpload,
          getPublicUrl: () => ({ data: { publicUrl: "https://cdn.test/audio.webm" } }),
        };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({ data: { prompt_text: "Describe the picture." } }),
      };
    },
  }),
}));

const { POST } = await import("./route");

// Ver comentário equivalente em route.test.ts da Fase 2 sobre por que o
// corpo é um fake `.formData()`/`headers.get()` em vez de um Request real
// com FormData/File.
function makeRequest(
  overrides: Partial<Record<string, string>> = {},
  { audio = new Blob(["fake"], { type: "audio/webm" }), contentLength }: { audio?: Blob | null; contentLength?: string } = {},
): Request {
  const formData = new FormData();
  formData.set("attemptId", overrides.attemptId ?? "attempt-1");
  formData.set("promptId", overrides.promptId ?? "prompt-1");
  formData.set("stage", overrides.stage ?? "picture_description");
  formData.set("slot", overrides.slot ?? "0");
  formData.set("repetitionCount", overrides.repetitionCount ?? "0");
  if (audio) formData.set("audio", audio, "audio.webm");
  return {
    formData: async () => formData,
    headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? contentLength ?? null : null) },
  } as unknown as Request;
}

const attempt = {
  id: "attempt-1",
  user_id: "user-1",
  phase: "pilot_interview",
  status: "in_progress",
  mode: "practice",
  current_part: "part4",
  current_item_index: 0,
  item_sequence: null,
};

const sequence = {
  part1: [],
  part2: [],
  part3: [],
  part4: [
    {
      id: "prompt-1",
      part: "part4",
      promptText: "x",
      atcAudioText: null,
      atcAudioUrl: null,
      expectedReadback: null,
      complicationText: null,
      complicationImageUrl: null,
      expectedReaction: null,
      atcFollowupAudioText: null,
      atcFollowupAudioUrl: null,
      expectedConfirmation: null,
      dialogueAudioUrl: null,
      discussionQuestion: null,
      discussionQuestion2: null,
      imageUrl: null,
      agreeDisagreeStatement: "Agree or disagree.",
      expectedDurationSeconds: 45,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({ user: { id: "user-1", operational_profile: "fixed_wing" } });
  assertOwnAttemptInProgress.mockResolvedValue(attempt);
  getSequenceForAttempt.mockResolvedValue(sequence);
  validateAudioContainer.mockReturnValue({ ok: true, container: "webm" });
  validateDecodedAudio.mockResolvedValue({ ok: true, container: "webm", durationSeconds: 12 });
  assertSubmissionRate.mockResolvedValue(undefined);
  getConsentStatus.mockResolvedValue({ accepted: true, version: "test", acceptedAt: "2026-01-01T00:00:00Z" });
  storageUpload.mockResolvedValue({ error: null });
  transcribeAudio.mockResolvedValue("This is a picture of an airport.");
  generatePilotResponseFeedback.mockResolvedValue("Nice description.");
});

describe("POST /api/sdea/submit-response", () => {
  it("rejeita quando o consentimento de gravação ainda não foi aceito — Milestone 3.3, antes até de parsear o formulário", async () => {
    getConsentStatus.mockResolvedValue({ accepted: false, version: "test", acceptedAt: null });
    const formDataSpy = vi.fn();
    const res = await POST({ formData: formDataSpy, headers: { get: () => null } } as unknown as Request);
    expect(res.status).toBe(403);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(reserveResponseSlot).not.toHaveBeenCalled();
  });

  it("rejeita corpo maior que o limite pelo Content-Length, sem autenticar", async () => {
    const res = await POST(makeRequest({}, { contentLength: String(50 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("autentica ANTES de ler o corpo", async () => {
    const { AuthError } = await import("@/lib/auth/authorize");
    authorize.mockRejectedValue(new AuthError("unauthenticated", "Sessão expirada."));
    const formDataSpy = vi.fn();
    const res = await POST({ formData: formDataSpy, headers: { get: () => null } } as unknown as Request);
    expect(res.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  it("rejeita item de outra tentativa, sem gastar storage nem IA", async () => {
    const res = await POST(makeRequest({ promptId: "prompt-de-outra-tentativa" }));
    expect(res.status).toBe(403);
    expect(reserveResponseSlot).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("passa a sequência PERSISTIDA da tentativa (item_sequence) pra getSequenceForAttempt", async () => {
    const persisted = { part1: [], part2: [], part3: [], part4: ["prompt-1"] };
    assertOwnAttemptInProgress.mockResolvedValue({ ...attempt, item_sequence: persisted });
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    await POST(makeRequest());
    expect(getSequenceForAttempt).toHaveBeenCalledWith("attempt-1", "fixed_wing", persisted);
  });

  it("devolve 409 sem gastar storage/IA quando o guard sinaliza conflito", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "conflict" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("devolve o resultado em cache (replay) sem chamar IA de novo", async () => {
    reserveResponseSlot.mockResolvedValue({
      kind: "replay",
      response: { transcript: "cached", ai_feedback: "cached feedback" },
    });
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ transcript: "cached", feedback: "cached feedback" });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("Parte 4: envia a 2ª ocorrência de 'narrative' com slot=2 — o servidor valida, não infere", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-2", slot: 2 });
    const res = await POST(makeRequest({ stage: "narrative", slot: "2" }));
    expect(res.status).toBe(200);
    expect(reserveResponseSlot).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "prompt-1", stage: "narrative", slot: 2 }),
    );
  });

  it("fluxo normal: reserva, sobe o áudio, transcreve e gera feedback (practice)", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    // Confirma que o decode REALMENTE roda no fluxo normal — sem isto os
    // testes de "não decodifica antes de X" seriam vacuosos.
    expect(validateDecodedAudio).toHaveBeenCalledOnce();
    expect(storageUpload).toHaveBeenCalledOnce();
    expect(transcribeAudio).toHaveBeenCalledOnce();
    expect(generatePilotResponseFeedback).toHaveBeenCalledOnce();
    expect(body).toEqual({ transcript: "This is a picture of an airport.", feedback: "Nice description." });
  });

  it("modo official não chama geração de feedback", async () => {
    assertOwnAttemptInProgress.mockResolvedValue({ ...attempt, mode: "official" });
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(generatePilotResponseFeedback).not.toHaveBeenCalled();
    expect(body.feedback).toBeNull();
  });

  it("rejeita áudio inválido antes de guard/storage/IA", async () => {
    validateAudioContainer.mockReturnValue({ ok: false, reason: "Áudio vazio." });
    const res = await POST(makeRequest());
    expect(res.status).toBe(422);
    expect(reserveResponseSlot).not.toHaveBeenCalled();
  });

  it("respeita o rate limit antes de guard/storage/IA", async () => {
    const { ItemGuardError } = await import("@/lib/simulations/item-guard");
    assertSubmissionRate.mockRejectedValue(new ItemGuardError("Aguarde.", 429));
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(reserveResponseSlot).not.toHaveBeenCalled();
  });

  it("NÃO decodifica o áudio antes do rate limit — decode é caro e só roda depois (achado da 4ª rodada)", async () => {
    const { ItemGuardError } = await import("@/lib/simulations/item-guard");
    assertSubmissionRate.mockRejectedValue(new ItemGuardError("Aguarde alguns segundos.", 429));
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(validateDecodedAudio).not.toHaveBeenCalled();
  });

  it("NÃO decodifica o áudio quando a reserva de slot dá conflito (corrida) — nenhum processo de ffmpeg é gasto", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "conflict" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(validateDecodedAudio).not.toHaveBeenCalled();
  });

  it("NÃO decodifica o áudio num replay idempotente (resultado já em cache)", async () => {
    reserveResponseSlot.mockResolvedValue({
      kind: "replay",
      response: { transcript: "cached", ai_feedback: "cached feedback" },
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(validateDecodedAudio).not.toHaveBeenCalled();
  });

  it("decodifica só DEPOIS da reserva, e um arquivo que não decodifica marca a linha reservada como erro (conta pro teto de retry) — achado da 4ª rodada", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    validateDecodedAudio.mockResolvedValue({ ok: false, reason: "Arquivo de áudio corrompido ou não decodificável." });
    const res = await POST(makeRequest());
    expect(res.status).toBe(422);
    expect(reserveResponseSlot).toHaveBeenCalledOnce();
    expect(adminUpdate).toHaveBeenCalledWith(expect.objectContaining({ processing_status: "error" }));
    expect(storageUpload).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});
