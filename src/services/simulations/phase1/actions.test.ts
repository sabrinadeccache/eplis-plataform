import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }) }));
vi.mock("@/lib/auth/authorize", () => ({
  authorizeOrRedirect: vi.fn(async () => ({ user: { id: "user-1", operational_profile: "APP" } })),
}));

let answers: { question_id: string; is_correct: boolean }[] = [];
const insertAnswer = vi.fn();
const attempt = {
  id: "attempt-1",
  user_id: "user-1",
  phase: "phase1",
  status: "in_progress",
  mode: "official",
  item_sequence: { phase1: ["q1", "q2", "q3"] },
};

function serverBuilder(table: string) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(async () => table === "phase1_answers"
      ? { data: answers, error: null }
      : { data: null, error: null }),
    single: vi.fn(async () => ({ data: table === "simulation_attempts" ? attempt : null, error: null })),
  };
  return chain;
}

function adminBuilder(table: string) {
  const state: { id?: string; payload?: Record<string, unknown> } = {};
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((column: string, value: string) => { if (column === "id") state.id = value; return chain; }),
    insert: vi.fn((payload: Record<string, unknown>) => { state.payload = payload; return chain; }),
    single: vi.fn(async () => {
      if (table === "phase1_questions") return { data: { correct_option: state.id === "q1" ? "a" : "b", audio_id: "audio-1" }, error: null };
      if (table === "phase1_answers") {
        insertAnswer(state.payload);
        return { data: { is_correct: state.payload?.is_correct ?? false }, error: null };
      }
      if (table === "phase1_audios") return { data: { transcript: "texto" }, error: null };
      return { data: null, error: null };
    }),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: (table: string) => serverBuilder(table) })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: (table: string) => adminBuilder(table) })),
}));

const { recordAnswer } = await import("./actions");

beforeEach(() => {
  answers = [];
  vi.clearAllMocks();
});

describe("recordAnswer — sequência autoritativa da Fase 1", () => {
  it("aceita somente a questão corrente e deriva o acerto no servidor", async () => {
    await expect(recordAnswer("attempt-1", "q1", "a")).resolves.toEqual({ isCorrect: true });
    expect(insertAnswer).toHaveBeenCalledWith(expect.objectContaining({ question_id: "q1", is_correct: true }));
  });

  it("recusa item futuro antes de inserir", async () => {
    await expect(recordAnswer("attempt-1", "q2", "b")).rejects.toThrow(/questão corrente/);
    expect(insertAnswer).not.toHaveBeenCalled();
  });

  it("trata replay de item já respondido sem duplicar", async () => {
    answers = [{ question_id: "q1", is_correct: false }];
    await expect(recordAnswer("attempt-1", "q1", "a")).resolves.toEqual({ isCorrect: false });
    expect(insertAnswer).not.toHaveBeenCalled();
  });
});
