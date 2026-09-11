import { describe, expect, it } from "vitest";
import { assertCurrentPrompt, ItemGuardError, reserveResponseSlot } from "./item-guard";

type Row = {
  id: string;
  item_slot: number | null;
  response_stage: string;
  processing_status: string;
  transcript: string | null;
  ai_feedback: string | null;
};

// Fake mínimo do client do Supabase o bastante pro que reserveResponseSlot
// usa: `.from(table).select(...).eq(...).eq(...)` (lê linhas existentes) no
// client "supabase" (RLS), e `.from(table).update(...).eq(...).eq(...).select().maybeSingle()`
// / `.insert(...).select().single()` no client "admin" (service_role).
function makeFakeDb(initialRows: Row[]) {
  const rows = [...initialRows];
  let nextId = rows.length + 1;
  let forceInsertConflict = false;

  // `reserveResponseSlot` faz `const { data } = await supabase.from(table).select(...).eq(...).eq(...)`
  // — o builder precisa ser "thenable" pra funcionar com `await` direto,
  // sem precisar simular um client real do Supabase inteiro. Este fake só
  // tem UM (attempt, prompt) por teste, então os filtros `.eq(...)` não
  // precisam de fato restringir nada — devolve sempre todas as linhas.
  const supabase = {
    from(_table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
      };
      return builder;
    },
  };

  const admin = {
    from(_table: string) {
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
              transcript: null,
              ai_feedback: null,
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

describe("reserveResponseSlot", () => {
  it("reserva o primeiro slot vazio quando o estágio bate com o esperado", async () => {
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
      expectedStages: ["situation_check", "suggestion"],
    });
    expect(outcome).toMatchObject({ kind: "reserved", slot: 0 });
  });

  it("rejeita estágio fora de ordem (pula direto pro 2º sem o 1º)", async () => {
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
        expectedStages: ["situation_check", "suggestion"],
      }),
    ).rejects.toThrow("fora de ordem");
  });

  it("reaproveita a mesma linha (retry) quando o slot está com erro", async () => {
    const db = makeFakeDb([
      {
        id: "resp-1",
        item_slot: 0,
        response_stage: "main",
        processing_status: "error",
        transcript: null,
        ai_feedback: null,
      },
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
      expectedStages: ["main"],
    });
    expect(outcome).toEqual({ kind: "reserved", responseId: "resp-1", slot: 0 });
    expect(db.rows.find((r) => r.id === "resp-1")?.processing_status).toBe("transcribing");
  });

  it("rejeita como conflito uma 2ª chamada concorrente pro mesmo estágio em voo", async () => {
    const db = makeFakeDb([
      {
        id: "resp-1",
        item_slot: 0,
        response_stage: "main",
        processing_status: "transcribing",
        transcript: null,
        ai_feedback: null,
      },
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
      expectedStages: ["main"],
    });
    expect(outcome).toEqual({ kind: "conflict" });
  });

  it("devolve replay (cache) quando o item já está totalmente respondido e o estágio bate com um já concluído", async () => {
    const db = makeFakeDb([
      {
        id: "resp-1",
        item_slot: 0,
        response_stage: "situation_check",
        processing_status: "done",
        transcript: "I see a runway incursion.",
        ai_feedback: "Good.",
      },
      {
        id: "resp-2",
        item_slot: 1,
        response_stage: "suggestion",
        processing_status: "done",
        transcript: "I suggest holding position.",
        ai_feedback: "Clear.",
      },
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
      expectedStages: ["situation_check", "suggestion"],
    });
    expect(outcome).toEqual({
      kind: "replay",
      response: db.rows.find((r) => r.id === "resp-2"),
    });
  });

  it("rejeita quando o item já está completo e o estágio não corresponde a nenhum slot concluído", async () => {
    const db = makeFakeDb([
      {
        id: "resp-1",
        item_slot: 0,
        response_stage: "main",
        processing_status: "done",
        transcript: "ok",
        ai_feedback: null,
      },
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
        stage: "outro-estagio-qualquer",
        expectedStages: ["main"],
      }),
    ).rejects.toThrow("já foi totalmente respondido");
  });

  it("distingue as duas ocorrências de 'narrative' (Parte 4 do SDEA) por slot, não por nome do estágio", async () => {
    const db = makeFakeDb([
      {
        id: "resp-1",
        item_slot: 0,
        response_stage: "picture_description",
        processing_status: "done",
        transcript: "ok",
        ai_feedback: null,
      },
      {
        id: "resp-2",
        item_slot: 1,
        response_stage: "narrative",
        processing_status: "done",
        transcript: "before",
        ai_feedback: null,
      },
    ]);
    const outcome = await reserveResponseSlot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: db.supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: db.admin as any,
      table: "pilot_responses",
      attemptId: "attempt-1",
      promptId: "prompt-1",
      stage: "narrative",
      expectedStages: ["picture_description", "narrative", "narrative"],
    });
    // Não é replay do slot 1 — é uma reserva nova pro slot 2 (a "hipótese de
    // depois"), mesmo estágio, posição diferente.
    expect(outcome).toMatchObject({ kind: "reserved", slot: 2 });
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
      expectedStages: ["main"],
    });
    expect(outcome).toEqual({ kind: "conflict" });
  });
});
