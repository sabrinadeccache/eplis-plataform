import { describe, expect, it, vi, beforeEach } from "vitest";

type QuestionRow = {
  id: string;
  prompt: string;
  option_a: string;
  option_b: string;
  option_c: string;
  phase1_audios: { audio_url: string } | null;
};

const QUESTIONS: QuestionRow[] = Array.from({ length: 40 }, (_, i) => ({
  id: `q${i}`,
  prompt: `pergunta ${i}`,
  option_a: "a",
  option_b: "b",
  option_c: "c",
  phase1_audios: { audio_url: `https://example.test/${i}.mp3` },
}));

// Estado controlado por cada teste.
let ATTEMPT_IDS: string[] = [];
let ANSWERED_QUESTION_IDS: string[] = [];

function builder(table: string) {
  const state: { filters: Record<string, unknown> } = { filters: {} };

  function resolve(): { data: unknown; error: null } {
    if (table === "phase1_questions") return { data: QUESTIONS, error: null };
    if (table === "simulation_attempts") {
      return { data: ATTEMPT_IDS.map((id) => ({ id })), error: null };
    }
    if (table === "phase1_answers") {
      const scope = state.filters["simulation_attempt_id"] as string[] | undefined;
      const rows = ANSWERED_QUESTION_IDS.map((question_id) => ({ question_id }));
      return { data: scope ? rows : [], error: null };
    }
    return { data: [], error: null };
  }

  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      state.filters[column] = value;
      return chain;
    },
    in: (column: string, values: unknown[]) => {
      state.filters[column] = values;
      return chain;
    },
    then: (onFulfilled: (v: ReturnType<typeof resolve>) => unknown) => onFulfilled(resolve()),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: (table: string) => builder(table) })),
}));

const { getRandomQuizQuestions } = await import("./queries");

beforeEach(() => {
  ATTEMPT_IDS = [];
  ANSWERED_QUESTION_IDS = [];
});

describe("getRandomQuizQuestions", () => {
  it("respeita o limite e não repete pergunta dentro do mesmo sorteio", async () => {
    const items = await getRandomQuizQuestions(30);
    expect(items).toHaveLength(30);
    expect(new Set(items.map((i) => i.id)).size).toBe(30);
  });

  it("prioriza perguntas ainda não respondidas pelo usuário", async () => {
    ATTEMPT_IDS = ["a1"];
    // 25 das 40 perguntas já foram respondidas.
    ANSWERED_QUESTION_IDS = Array.from({ length: 25 }, (_, i) => `q${i}`);

    const items = await getRandomQuizQuestions(10, "user-1");
    expect(items).toHaveLength(10);
    // Restam 15 inéditas (q25..q39) — todas as 10 sorteadas devem sair delas.
    for (const item of items) {
      expect(ANSWERED_QUESTION_IDS).not.toContain(item.id);
    }
  });

  it("recomeça o ciclo (inclui repetidas) quando as inéditas acabam", async () => {
    ATTEMPT_IDS = ["a1"];
    ANSWERED_QUESTION_IDS = QUESTIONS.map((q) => q.id).slice(0, 38);

    const items = await getRandomQuizQuestions(10, "user-1");
    expect(items).toHaveLength(10);
    const fresh = items.filter((i) => !ANSWERED_QUESTION_IDS.includes(i.id));
    // As 2 inéditas (q38, q39) vêm primeiro.
    expect(fresh).toHaveLength(2);
    expect(items.slice(0, 2).every((i) => !ANSWERED_QUESTION_IDS.includes(i.id))).toBe(true);
  });

  it("sem userId, é sorteio puro sobre todo o pool ativo", async () => {
    ANSWERED_QUESTION_IDS = QUESTIONS.map((q) => q.id);
    const items = await getRandomQuizQuestions(30);
    expect(items).toHaveLength(30);
  });
});
