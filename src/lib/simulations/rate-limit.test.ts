import { describe, expect, it } from "vitest";
import { assertSubmissionRate } from "./rate-limit";
import { ItemGuardError } from "./item-guard";

// Fake do client "supabase" (RLS) — as duas consultas de contagem (total por
// tentativa, total do usuário no dia), na ordem.
function makeFakeSupabase(counts: [number, number], errorOnCall: number | null = null) {
  let call = 0;
  return {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        gte() {
          return builder;
        },
        then(resolve: (v: { count: number | null; error: { message: string } | null }) => void) {
          call += 1;
          if (errorOnCall === call) {
            resolve({ count: null, error: { message: "boom" } });
            return;
          }
          resolve({ count: counts[call - 1], error: null });
        },
      };
      return builder;
    },
  };
}

// Fake do client "admin" (service_role) — simula o compare-and-swap de
// `last_submission_at`. `cooldownAllows` decide se o UPDATE "encontra" a
// linha (CAS bem-sucedido) ou não (retry chegou cedo demais) — é
// exatamente o que o `.or("last_submission_at.is.null,last_submission_at.lte.…")`
// real do Postgres decide; aqui é controlado direto pelo teste porque o
// objetivo é validar a DECISÃO de `assertSubmissionRate`, não a sintaxe do
// filtro Postgrest em si.
function makeFakeAdmin(cooldownAllows: boolean, errorOnUpdate = false) {
  const updateCalls: unknown[] = [];
  const admin = {
    from() {
      const builder = {
        update(payload: unknown) {
          updateCalls.push(payload);
          return builder;
        },
        eq() {
          return builder;
        },
        or() {
          return builder;
        },
        select() {
          return builder;
        },
        async maybeSingle() {
          if (errorOnUpdate) return { data: null, error: { message: "boom" } };
          return { data: cooldownAllows ? { id: "attempt-1" } : null, error: null };
        },
      };
      return builder;
    },
  };
  return { admin, updateCalls };
}

describe("assertSubmissionRate", () => {
  it("permite envio normal, bem abaixo dos limites", async () => {
    const supabase = makeFakeSupabase([3, 10]);
    const { admin } = makeFakeAdmin(true);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, admin as any, "phase2_responses", "attempt-1", "user-1"),
    ).resolves.toBeUndefined();
  });

  it("rejeita quando o cooldown do CAS não deixa passar — inclui a sequência de 5 retries do MESMO slot em menos de 1s (achado exato da revisão)", async () => {
    // O cenário apontado: 5 retries do mesmo slot criam só 1 linha de
    // resposta (reaproveitada), então contar linhas nunca pegaria isso —
    // é o CAS em `last_submission_at`, não a contagem de linhas, que
    // barra a 2ª chamada em diante dentro da janela mínima.
    const supabase = makeFakeSupabase([1, 1]);
    const { admin } = makeFakeAdmin(false); // CAS não encontrou linha elegível -> muito cedo
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, admin as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow(ItemGuardError);
  });

  it("checa o cooldown ANTES das contagens de linha (nem chega a consultá-las se o cooldown já rejeitou)", async () => {
    let queried = false;
    const supabase = {
      from() {
        queried = true;
        return makeFakeSupabase([0, 0]).from();
      },
    };
    const { admin } = makeFakeAdmin(false);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, admin as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow(ItemGuardError);
    expect(queried).toBe(false);
  });

  it("falha fechado quando o próprio UPDATE do cooldown dá erro", async () => {
    const supabase = makeFakeSupabase([0, 0]);
    const { admin } = makeFakeAdmin(true, true);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, admin as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow(ItemGuardError);
  });

  it("rejeita quando a tentativa já acumulou o teto de respostas (linhas novas, não retries)", async () => {
    const supabase = makeFakeSupabase([60, 10]);
    const { admin } = makeFakeAdmin(true);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, admin as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow("Limite de respostas");
  });

  it("rejeita quando o usuário já acumulou o teto diário agregado", async () => {
    const supabase = makeFakeSupabase([3, 250]);
    const { admin } = makeFakeAdmin(true);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, admin as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow("Limite diário");
  });

  it("falha fechado (rejeita, não libera) quando uma consulta de contagem dá erro", async () => {
    const supabase = makeFakeSupabase([3, 10], 1);
    const { admin } = makeFakeAdmin(true);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, admin as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow(ItemGuardError);
  });
});
