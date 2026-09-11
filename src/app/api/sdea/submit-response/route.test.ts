import { describe, expect, it, vi, beforeEach } from "vitest";

// Mesmo padrão de src/app/api/phase2/submit-response/route.test.ts — mocka
// na fronteira de cada responsabilidade (a lógica interna de
// `reserveResponseSlot`/`validateAudioUpload` já é coberta em seus próprios
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

const validateAudioUpload = vi.fn();
vi.mock("@/lib/audio/validate", () => ({ validateAudioUpload }));

const reserveResponseSlot = vi.fn();
vi.mock("@/lib/simulations/item-guard", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, reserveResponseSlot };
});

const assertSubmissionRate = vi.fn();
vi.mock("@/lib/simulations/rate-limit", () => ({ assertSubmissionRate }));

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
// corpo é um fake `.formData()` em vez de um Request real com FormData/File.
function makeRequest(
  overrides: Partial<Record<string, string>> = {},
  audio: Blob | null = new Blob(["fake"], { type: "audio/webm" }),
): Request {
  const formData = new FormData();
  formData.set("attemptId", overrides.attemptId ?? "attempt-1");
  formData.set("promptId", overrides.promptId ?? "prompt-1");
  formData.set("stage", overrides.stage ?? "picture_description");
  formData.set("repetitionCount", overrides.repetitionCount ?? "0");
  if (audio) formData.set("audio", audio, "audio.webm");
  return { formData: async () => formData } as unknown as Request;
}

const attempt = {
  id: "attempt-1",
  user_id: "user-1",
  phase: "pilot_interview",
  status: "in_progress",
  mode: "practice",
  current_part: "part4",
  current_item_index: 0,
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
  validateAudioUpload.mockReturnValue({ ok: true, container: "webm", durationSeconds: 12 });
  assertSubmissionRate.mockResolvedValue(undefined);
  storageUpload.mockResolvedValue({ error: null });
  transcribeAudio.mockResolvedValue("This is a picture of an airport.");
  generatePilotResponseFeedback.mockResolvedValue("Nice description.");
});

describe("POST /api/sdea/submit-response", () => {
  it("rejeita item de outra tentativa, sem gastar storage nem IA", async () => {
    const res = await POST(makeRequest({ promptId: "prompt-de-outra-tentativa" }));
    expect(res.status).toBe(403);
    expect(reserveResponseSlot).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
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

  it("Parte 4: envia a 2ª ocorrência de 'narrative' passando a mesma promptId/estágio — o guard (não a rota) decide o slot", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-2", slot: 2 });
    const res = await POST(makeRequest({ stage: "narrative" }));
    expect(res.status).toBe(200);
    expect(reserveResponseSlot).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "prompt-1", stage: "narrative" }),
    );
  });

  it("fluxo normal: reserva, sobe o áudio, transcreve e gera feedback (practice)", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
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
    validateAudioUpload.mockReturnValue({ ok: false, reason: "Áudio vazio." });
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
});
