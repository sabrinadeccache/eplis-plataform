import { describe, expect, it, vi, beforeEach } from "vitest";

const generateSpeechAudio = vi.fn(async () => ({
  buffer: Buffer.from("fake-audio"),
  mimeType: "audio/mpeg",
}));

vi.mock("@/lib/ai/openai", () => ({ generateSpeechAudio }));
vi.mock("@/lib/ai/anthropic", () => ({
  generateFinalReport: vi.fn(),
  generateResponseFeedback: vi.fn(),
  MODEL_VERSION: "test-model",
}));

type FakeAttempt = {
  id: string;
  user_id: string;
  phase: string;
  status: string;
  mode: string;
  current_part: string;
  current_item_index: number;
};

let authUserId: string | null = "user-1";
let attempt: FakeAttempt | null = {
  id: "attempt-1",
  user_id: "user-1",
  phase: "phase2",
  status: "in_progress",
  mode: "practice",
  current_part: "part1",
  current_item_index: 0,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authUserId ? { id: authUserId } : null } })),
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({ data: attempt }),
      };
    },
  })),
}));

const { generateSpeech } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  authUserId = "user-1";
  attempt = {
    id: "attempt-1",
    user_id: "user-1",
    phase: "phase2",
    status: "in_progress",
    mode: "practice",
    current_part: "part1",
    current_item_index: 0,
  };
});

describe("generateSpeech — proteção de custo", () => {
  it("gera áudio normalmente para uma tentativa própria em andamento", async () => {
    const result = await generateSpeech("attempt-1", "Hello, candidate.");
    expect(result.audioBase64).toBe(Buffer.from("fake-audio").toString("base64"));
    expect(generateSpeechAudio).toHaveBeenCalledWith("Hello, candidate.");
  });

  it("rejeita texto além do tamanho máximo, sem chamar a API paga", async () => {
    await expect(generateSpeech("attempt-1", "x".repeat(1501))).rejects.toThrow(
      "Texto muito longo",
    );
    expect(generateSpeechAudio).not.toHaveBeenCalled();
  });

  it("rejeita sem sessão autenticada", async () => {
    authUserId = null;
    await expect(generateSpeech("attempt-1", "oi")).rejects.toThrow("Não autenticado.");
    expect(generateSpeechAudio).not.toHaveBeenCalled();
  });

  it("rejeita tentativa de outro usuário", async () => {
    attempt = { ...attempt!, user_id: "other-user" };
    await expect(generateSpeech("attempt-1", "oi")).rejects.toThrow(
      "Tentativa inválida ou já finalizada.",
    );
    expect(generateSpeechAudio).not.toHaveBeenCalled();
  });

  it("rejeita tentativa já concluída", async () => {
    attempt = { ...attempt!, status: "completed" };
    await expect(generateSpeech("attempt-1", "oi")).rejects.toThrow(
      "Tentativa inválida ou já finalizada.",
    );
    expect(generateSpeechAudio).not.toHaveBeenCalled();
  });
});
