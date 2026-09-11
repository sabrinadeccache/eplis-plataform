import { describe, expect, it } from "vitest";
import { assertCurrentPrompt, assertValidSlot, ItemGuardError, MAX_RETRIES_PER_SLOT, reserveResponseSlot } from "./item-guard";

type Row = {
  id: string;
  item_slot: number | null;
  response_stage: string;
  processing_status: string;
  retry_count: number | null;
  transcript: string | null;
  ai_feedback: string | null;
  created_at: string;
};

// Fake mínimo do client do Supabase o bastante pro que reserveResponseSlot
// usa: `.from(table).select(...).eq(...).eq(...)` (lê linhas existentes) no
// client "supabase" (RLS), e `.from(table).update(...).eq(...).eq(...).select().maybeSingle()`
// / `.insert(...).select().single()` no client "admin" (service_role).
function makeFakeDb(initialRows: Row[]) {
  const rows = [...initialRows];
  let nextId = rows.length + 1;
  let nextCreatedAt = rows.length + 1;
  let forceInsertConflict = false;
  let forceReadError = false;

  const supabase = {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        then(resolve: (v: { data: Row[] | null; error: { message: string } | null }) => void) {
          if (forceReadError) {
            resolve({ data: null, error: { message: "boom" } });
            return;
          }
          resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
      };
      return builder;
    },
  };

  const admin = {
    from() {
      const updateFilters: { id?: string; processing_status?: string } = {};
      let updatePayload: Record<string, unknown> | null = null;
      let insertPayload: Record<string, unknown> | null = null;
      const builder = {
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          insertPayload = payload;
          return builder;
        },
        eq(col: string, val: unknown) {
          if (col === "id") updateFilters.id = val as string;
          if (col === "processing_status") updateFilters.processing_status = val as string;
          return builder;
        },
        select() {
          return builder;
        },
        async maybeSingle() {
          if (updatePayload) {
            const row = rows.find((r) => r.id === updateFilters.id);
            if (!row) return { data: null, error: null };
            if (updateFilters.processing_status && row.processing_status !== updateFilters.processing_status) {
              return { data: null, error: null }; // CAS falhou
            }
            Object.assign(row, updatePayload);
            return { data: { id: row.id }, error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          if (insertPayload) {
            if (forceInsertConflict) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            const row: Row = {
              id: `resp-${nextId++}`,
              item_slot: insertPayload.item_slot as number,
              response_stage: insertPayload.response_stage as string,
              processing_status: insertPayload.processing_status as string,
              retry_count: 0,
              transcript: null,
              ai_feedback: null,
              created_at: `2026-01-01T00:00:${String(nextCreatedAt++).padStart(2, "0")}Z`,
            };
            rows.push(row);
            return { data: { id: row.id }, error: null };
          }
          return { data: null, error: { message: "sem payload" } };
        },
      };
      return builder;
    },
  };

  return {
    supabase,
    admin,
    get rows() {
      return rows;
    },
    setForceInsertConflict(v: boolean) {
      forceInsertConflict = v;
    },
    setForceReadError(v: boolean) {
      forceReadError = v;
    },
  };
}

function row(overrides: Partial<Row> & { id: string; item_slot: number | null; response_stage: string }): Row {
  return {
    processing_status: "done",
    retry_count: 0,
    transcript: null,
    ai_feedback: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("assertCurrentPrompt", () => {
  it("aceita quando o promptId enviado bate com o item corrente", () => {
    expect(() => assertCurrentPrompt("prompt-1", "prompt-1")).not.toThrow();
  });

  it("rejeita prompt de outro item/tentativa", () => {
    expect(() => assertCurrentPrompt("prompt-1", "prompt-de-outra-tentativa")).toThrow(ItemGuardError);
  });

  it("rejeita quando a sequência não tem prompt pra essa posição (item futuro/inválido)", () => {
    expect(() => assertCurrentPrompt(undefined, "qualquer")).toThrow(ItemGuardError);
  });
});

describe("assertValidSlot", () => {
  it("aceita slot dentro dos limites cujo estágio bate", () => {
    expect(() => assertValidSlot(0, "main", ["main"])).not.toThrow();
  });

  it("rejeita slot fora dos limites (negativo ou além do fim)", () => {
    expect(() => assertValidSlot(-1, "main", ["main"])).toThrow(ItemGuardError);
    expect(() => assertValidSlot(2, "main", ["main"])).toThrow(ItemGuardError);
  });

  it("rejeita slot não-inteiro", () => {
    expect(() => assertValidSlot(1.5, "suggestion", ["situation_check", "suggestion"])).toThrow(ItemGuardError);
  });

  it("rejeita quando o estágio não corresponde à posição informada", () => {
    expect(() => assertValidSlot(0, "suggestion", ["situation_check", "suggestion"])).toThrow(ItemGuardError);
  });
});

describe("reserveResponseSlot", () => {
  it("reserva o primeiro slot vazio quando slot e estágio batem com o esperado", async () => {
    const db = makeFakeDb([]);
    const outcome = await reserveResponseSlot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: db.supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: db.admin as any,
      table: "phase2_responses",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "situation_check",
      slot: 0,
      expectedStages: ["situation_check", "suggestion"],
    });
    expect(outcome).toMatchObject({ kind: "reserved", slot: 0 });
  });

  it("rejeita slot fora de ordem (pula direto pro 2º sem o 1º existir)", async () => {
    const db = makeFakeDb([]);
    await expect(
      reserveResponseSlot({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: db.supabase as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        admin: db.admin as any,
        table: "phase2_responses",
        attemptId: "attempt-1",
        promptId: "prompt-1",
        stage: "suggestion",
        slot: 1,
        expectedStages: ["situation_check", "suggestion"],
      }),
    ).rejects.toThrow("fora de ordem");
  });

  it("reaproveita a mesma linha (retry) quando o slot está com erro, e incrementa retry_count", async () => {
    const db = makeFakeDb([row({ id: "resp-1", item_slot: 0, response_stage: "main", processing_status: "error" })]);
    const outcome = await reserveResponseSlot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: db.supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: db.admin as any,
      table: "phase2_responses",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "main",
      slot: 0,
      expectedStages: ["main"],
    });
    expect(outcome).toEqual({ kind: "reserved", responseId: "resp-1", slot: 0 });
    const updated = db.rows.find((r) => r.id === "resp-1");
    expect(updated?.processing_status).toBe("transcribing");
    expect(updated?.retry_count).toBe(1);
  });

  it("rejeita retry além do teto de reprocessamento (MAX_RETRIES_PER_SLOT)", async () => {
    const db = makeFakeDb([
      row({
        id: "resp-1",
        item_slot: 0,
        response_stage: "main",
        processing_status: "error",
        retry_count: MAX_RETRIES_PER_SLOT,
      }),
    ]);
    await expect(
      reserveResponseSlot({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: db.supabase as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        admin: db.admin as any,
        table: "phase2_responses",
        attemptId: "attempt-1",
        promptId: "prompt-1",
        stage: "main",
        slot: 0,
        expectedStages: ["main"],
      }),
    ).rejects.toThrow("Muitas tentativas");
  });

  it("rejeita como conflito uma 2ª chamada concorrente pro mesmo slot em voo", async () => {
    const db = makeFakeDb([
      row({ id: "resp-1", item_slot: 0, response_stage: "main", processing_status: "transcribing" }),
    ]);
    const outcome = await reserveResponseSlot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: db.supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: db.admin as any,
      table: "phase2_responses",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "main",
      slot: 0,
      expectedStages: ["main"],
    });
    expect(outcome).toEqual({ kind: "conflict" });
  });

  it("devolve replay (cache) quando o retry chega com o MESMO slot de uma resposta já concluída — idempotência real", async () => {
    const db = makeFakeDb([
      row({
        id: "resp-1",
        item_slot: 0,
        response_stage: "situation_check",
        processing_status: "done",
        transcript: "I see a runway incursion.",
        ai_feedback: "Good.",
      }),
      row({ id: "resp-2", item_slot: 1, response_stage: "suggestion", processing_status: "done" }),
    ]);
    const outcome = await reserveResponseSlot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: db.supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: db.admin as any,
      table: "phase2_responses",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "situation_check",
      slot: 0, // retry do 1º slot, não uma submissão nova
      expectedStages: ["situation_check", "suggestion"],
    });
    expect(outcome).toEqual({
      kind: "replay",
      response: db.rows.find((r) => r.id === "resp-1"),
    });
  });

  it("distingue as duas ocorrências de 'narrative' (Parte 4 do SDEA) pelo slot informado pelo cliente, sem ambiguidade", async () => {
    const db = makeFakeDb([
      row({ id: "resp-1", item_slot: 0, response_stage: "picture_description", processing_status: "done" }),
      row({ id: "resp-2", item_slot: 1, response_stage: "narrative", processing_status: "done", transcript: "before" }),
    ]);

    // Retry do slot 1 (a 1ª narrative) — deve dar replay, NUNCA criar o slot 2.
    const retryOutcome = await reserveResponseSlot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: db.supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: db.admin as any,
      table: "pilot_responses",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "narrative",
      slot: 1,
      expectedStages: ["picture_description", "narrative", "narrative"],
    });
    expect(retryOutcome).toEqual({ kind: "replay", response: db.rows.find((r) => r.id === "resp-2") });

    // Submissão nova de verdade da 2ª narrative — slot 2, explícito.
    const newOutcome = await reserveResponseSlot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: db.supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: db.admin as any,
      table: "pilot_responses",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "narrative",
      slot: 2,
      expectedStages: ["picture_description", "narrative", "narrative"],
    });
    expect(newOutcome).toMatchObject({ kind: "reserved", slot: 2 });
  });

  it("trata 23505 (unique_violation) no INSERT como corrida perdida, não como erro", async () => {
    const db = makeFakeDb([]);
    db.setForceInsertConflict(true);
    const outcome = await reserveResponseSlot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: db.supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: db.admin as any,
      table: "phase2_responses",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "main",
      slot: 0,
      expectedStages: ["main"],
    });
    expect(outcome).toEqual({ kind: "conflict" });
  });

  it("falha fechado (não abre passagem) quando a leitura das linhas existentes dá erro", async () => {
    const db = makeFakeDb([]);
    db.setForceReadError(true);
    await expect(
      reserveResponseSlot({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: db.supabase as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        admin: db.admin as any,
        table: "phase2_responses",
        attemptId: "attempt-1",
        promptId: "prompt-1",
        stage: "main",
        slot: 0,
        expectedStages: ["main"],
      }),
    ).rejects.toThrow(ItemGuardError);
  });

  it("preenche corretamente uma linha antiga sem item_slot (janela de deploy) e não deixa duplicar o slot dela", async () => {
    // Linha "legada" (de antes do item_slot existir) pro slot 0; a nova
    // submissão do slot 1 precisa reconhecer que o slot 0 já está ocupado.
    const db = makeFakeDb([
      row({
        id: "resp-legacy",
        item_slot: null,
        response_stage: "situation_check",
        processing_status: "done",
        created_at: "2020-01-01T00:00:00Z",
      }),
    ]);
    const outcome = await reserveResponseSlot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: db.supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: db.admin as any,
      table: "phase2_responses",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "suggestion",
      slot: 1,
      expectedStages: ["situation_check", "suggestion"],
    });
    expect(outcome).toMatchObject({ kind: "reserved", slot: 1 });
  });
});
