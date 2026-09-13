import { describe, expect, it, vi, beforeEach } from "vitest";

// Módulos mockados na fronteira de cada responsabilidade — o objetivo destes
// testes é o FLUXO da rota (o que ela chama, em que ordem, e o que devolve
// pra cada desfecho do guard), não redemonstrar a lógica interna de
// `reserveResponseSlot` (isso já é coberto por
// src/lib/simulations/item-guard.test.ts) nem de `validateAudioContainer`/`validateDecodedAudio`
// (src/lib/audio/validate.test.ts).

const authorize = vi.fn();
vi.mock("@/lib/auth/authorize", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, authorize };
});

const assertOwnAttemptInProgress = vi.fn();
vi.mock("@/services/simulations/phase2/actions", () => ({ assertOwnAttemptInProgress }));

const getSequenceForAttempt = vi.fn();
vi.mock("@/services/simulations/phase2/queries", () => ({ getSequenceForAttempt }));

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

const generateResponseFeedback = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  generateResponseFeedback,
  MODEL_VERSION: "test-model",
}));

const storageUpload = vi.fn();
const adminUpdate = vi.fn();
let accountStatus = "active";
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          adminUpdate(payload);
          return this;
        },
        select() {
          return this;
        },
        eq() {
          return this;
        },
        // Recheck de status (achado da revisão, M3): assertAccountStillActive
        // consulta `public.users` bem antes de persistir conteúdo — o
        // comportamento de bloqueio no meio da requisição é testado abaixo
        // ("recheca a conta perto da persistência...").
        async maybeSingle() {
          if (table === "users") return { data: { status: accountStatus }, error: null };
          return { data: null, error: null };
        },
        then(resolve: (v: { data: null; error: null }) => void) {
          resolve({ data: null, error: null });
        },
      };
    },
    // Upload das gravações passou a ser SÓ pelo client admin (service_role)
    // desde a revisão do M3 — o candidato não escreve mais no bucket com o
    // próprio client (achado real: as policies antigas permitiam isso
    // direto, contornando consentimento/guard/decode).
    storage: {
      from() {
        return { upload: storageUpload };
      },
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({ data: { prompt_text: "Describe the situation." } }),
      };
    },
  }),
}));

const { POST } = await import("./route");

// Monta um "Request" que só sabe responder `.formData()`/`headers.get()` —
// a rota nunca lê o corpo bruto, só chama `request.formData()`. Evita
// montar um Request de verdade com FormData/File como corpo: jsdom
// (ambiente destes testes) e o runtime de fetch do Node (undici) têm
// implementações de FormData/File de realms diferentes, e serializar uma
// pela outra falha na checagem WebIDL (`webidl.is.File`) — problema só do
// harness de teste, não da rota.
function makeRequest(
  overrides: Partial<Record<string, string>> = {},
  { audio = new Blob(["fake"], { type: "audio/webm" }), contentLength }: { audio?: Blob | null; contentLength?: string } = {},
): Request {
  const formData = new FormData();
  formData.set("attemptId", overrides.attemptId ?? "attempt-1");
  formData.set("promptId", overrides.promptId ?? "prompt-1");
  formData.set("stage", overrides.stage ?? "situation_check");
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
  phase: "phase2",
  status: "in_progress",
  mode: "practice",
  current_part: "part2",
  current_item_index: 0,
  item_sequence: null,
};

const sequence = {
  part1: [],
  part2: [{ id: "prompt-1", part: "part2", promptText: "x", imageUrl: null, expectedDurationSeconds: 30 }],
  part3: [],
  part4: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  accountStatus = "active";
  authorize.mockResolvedValue({ user: { id: "user-1", operational_profile: "APP" } });
  assertOwnAttemptInProgress.mockResolvedValue(attempt);
  getSequenceForAttempt.mockResolvedValue(sequence);
  validateAudioContainer.mockReturnValue({ ok: true, container: "webm" });
  validateDecodedAudio.mockResolvedValue({ ok: true, container: "webm", durationSeconds: 12 });
  assertSubmissionRate.mockResolvedValue(undefined);
  getConsentStatus.mockResolvedValue({ accepted: true, version: "test", acceptedAt: "2026-01-01T00:00:00Z" });
  storageUpload.mockResolvedValue({ error: null });
  transcribeAudio.mockResolvedValue("I see a runway incursion.");
  generateResponseFeedback.mockResolvedValue("Good job.");
});

describe("POST /api/phase2/submit-response", () => {
  it("rejeita quando o consentimento de gravação ainda não foi aceito — Milestone 3.3, antes até de parsear o formulário", async () => {
    getConsentStatus.mockResolvedValue({ accepted: false, version: "test", acceptedAt: null });
    const formDataSpy = vi.fn();
    const res = await POST({ formData: formDataSpy, headers: { get: () => null } } as unknown as Request);
    expect(res.status).toBe(403);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(reserveResponseSlot).not.toHaveBeenCalled();
  });

  it("rejeita corpo maior que o limite pelo Content-Length, sem sequer autenticar (achado da revisão)", async () => {
    const res = await POST(makeRequest({}, { contentLength: String(50 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("autentica ANTES de ler o corpo (achado da revisão: formData() materializava antes de authorize())", async () => {
    const { AuthError } = await import("@/lib/auth/authorize");
    authorize.mockRejectedValue(new AuthError("unauthenticated", "Sessão expirada."));
    const formDataSpy = vi.fn();
    const request = {
      formData: formDataSpy,
      headers: { get: () => null },
    } as unknown as Request;
    const res = await POST(request);
    expect(res.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  it("rejeita requisição sem os campos obrigatórios (depois de autenticar), sem chamar guard/storage/IA", async () => {
    const formData = new FormData();
    formData.set("attemptId", "attempt-1");
    const res = await POST({
      formData: async () => formData,
      headers: { get: () => null },
    } as unknown as Request);
    expect(res.status).toBe(400);
    expect(authorize).toHaveBeenCalledOnce();
    expect(reserveResponseSlot).not.toHaveBeenCalled();
  });

  it("rejeita áudio inválido (vazio/MIME forjado/duração excedida) antes de guard, storage ou IA", async () => {
    validateAudioContainer.mockReturnValue({ ok: false, reason: "Áudio vazio." });
    const res = await POST(makeRequest());
    expect(res.status).toBe(422);
    expect(reserveResponseSlot).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("rejeita item de outra tentativa / fora de ordem (promptId não bate com o item corrente), sem gastar storage nem IA", async () => {
    const res = await POST(makeRequest({ promptId: "prompt-de-outra-tentativa" }));
    expect(res.status).toBe(403);
    expect(reserveResponseSlot).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("rejeita item futuro/inexistente na sequência (posição corrente sem prompt correspondente)", async () => {
    getSequenceForAttempt.mockResolvedValue({ part1: [], part2: [], part3: [], part4: [] });
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });

  it("passa a sequência PERSISTIDA da tentativa (item_sequence) pra getSequenceForAttempt, não recalcula do zero", async () => {
    const persisted = { part1: [], part2: ["prompt-1"], part3: [], part4: [] };
    assertOwnAttemptInProgress.mockResolvedValue({ ...attempt, item_sequence: persisted });
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    await POST(makeRequest());
    expect(getSequenceForAttempt).toHaveBeenCalledWith("attempt-1", "APP", persisted);
  });

  it("respeita o rate limit antes de tocar em guard/storage/IA", async () => {
    const { ItemGuardError } = await import("@/lib/simulations/item-guard");
    assertSubmissionRate.mockRejectedValue(new ItemGuardError("Aguarde alguns segundos.", 429));
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(reserveResponseSlot).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("devolve 409 sem chamar storage/IA quando o guard sinaliza conflito (corrida/duplicata em voo)", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "conflict" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(storageUpload).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("devolve o resultado em cache sem chamar Whisper/Claude de novo quando o guard sinaliza replay (idempotência)", async () => {
    reserveResponseSlot.mockResolvedValue({
      kind: "replay",
      response: { transcript: "cached transcript", ai_feedback: "cached feedback" },
    });
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ transcript: "cached transcript", feedback: "cached feedback" });
    expect(storageUpload).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(generateResponseFeedback).not.toHaveBeenCalled();
  });

  it("recheca a conta perto da persistência: bloqueio no meio do processamento barra o upload (achado da revisão)", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    accountStatus = "blocked"; // simula exclusão/bloqueio disparado ENTRE authorize() e este ponto
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(storageUpload).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("fluxo normal: reserva o slot, sobe o áudio, transcreve e gera feedback (practice)", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    // Confirma que o decode REALMENTE roda no fluxo normal — sem isto os
    // testes de "não decodifica antes de X" seriam vacuosos.
    expect(validateDecodedAudio).toHaveBeenCalledOnce();
    expect(storageUpload).toHaveBeenCalledOnce();
    expect(transcribeAudio).toHaveBeenCalledOnce();
    expect(generateResponseFeedback).toHaveBeenCalledOnce();
    expect(body).toEqual({ transcript: "I see a runway incursion.", feedback: "Good job." });
  });

  it("modo official não chama geração de feedback (só transcreve)", async () => {
    assertOwnAttemptInProgress.mockResolvedValue({ ...attempt, mode: "official" });
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(generateResponseFeedback).not.toHaveBeenCalled();
    expect(body).toEqual({ transcript: "I see a runway incursion.", feedback: null });
  });

  it("marca a linha como erro e devolve 502 quando a transcrição falha, sem gerar feedback", async () => {
    reserveResponseSlot.mockResolvedValue({ kind: "reserved", responseId: "resp-1", slot: 0 });
    transcribeAudio.mockRejectedValue(new Error("Whisper indisponível"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    expect(generateResponseFeedback).not.toHaveBeenCalled();
    expect(adminUpdate).toHaveBeenCalledWith(expect.objectContaining({ processing_status: "error" }));
  });

  it("rejeita tentativa inválida/já finalizada sem gastar guard/storage/IA", async () => {
    assertOwnAttemptInProgress.mockRejectedValue(new Error("Tentativa inválida ou já finalizada."));
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(reserveResponseSlot).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
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
