import { describe, expect, it } from "vitest";
import { assertSubmissionRate } from "./rate-limit";
import { ItemGuardError } from "./item-guard";

// As 3 consultas de assertSubmissionRate, na ordem: (1) janela curta por
// `started_at` [retries entram aqui — atualizam started_at], (2) total por
// tentativa, (3) total do usuário no dia (embed em simulation_attempts).
function makeFakeSupabase(counts: [number, number, number], errorOnCall: number | null = null) {
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

describe("assertSubmissionRate", () => {
  it("permite envio normal, bem abaixo dos limites", async () => {
    const supabase = makeFakeSupabase([0, 3, 10]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, "phase2_responses", "attempt-1", "user-1"),
    ).resolves.toBeUndefined();
  });

  it("rejeita rajada — 2 envios já na janela curta (conta retries via started_at)", async () => {
    const supabase = makeFakeSupabase([2, 3, 10]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow(ItemGuardError);
  });

  it("rejeita quando a tentativa já acumulou o teto de respostas", async () => {
    const supabase = makeFakeSupabase([0, 60, 10]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow("Limite de respostas");
  });

  it("rejeita quando o usuário já acumulou o teto diário agregado", async () => {
    const supabase = makeFakeSupabase([0, 3, 250]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow("Limite diário");
  });

  it("falha fechado (rejeita, não libera) quando a consulta de contagem dá erro", async () => {
    const supabase = makeFakeSupabase([0, 3, 10], 1);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, "phase2_responses", "attempt-1", "user-1"),
    ).rejects.toThrow(ItemGuardError);
  });
});
