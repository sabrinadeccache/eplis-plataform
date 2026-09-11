import { describe, expect, it } from "vitest";
import { assertSubmissionRate } from "./rate-limit";
import { ItemGuardError } from "./item-guard";

function makeFakeSupabase(burstCount: number, attemptCount: number) {
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
        then(resolve: (v: { count: number; error: null }) => void) {
          call += 1;
          // A 1ª chamada de `assertSubmissionRate` é a janela curta (com
          // `.gte`), a 2ª é o total da tentativa (sem `.gte`) — refletido
          // aqui pela ordem de chamada, não por inspecionar os filtros.
          resolve({ count: call === 1 ? burstCount : attemptCount, error: null });
        },
      };
      return builder;
    },
  };
}

describe("assertSubmissionRate", () => {
  it("permite envio normal, bem abaixo dos limites", async () => {
    const supabase = makeFakeSupabase(0, 3);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, "phase2_responses", "attempt-1"),
    ).resolves.toBeUndefined();
  });

  it("rejeita rajada — 2 envios já na janela curta", async () => {
    const supabase = makeFakeSupabase(2, 3);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, "phase2_responses", "attempt-1"),
    ).rejects.toThrow(ItemGuardError);
  });

  it("rejeita quando a tentativa já acumulou o teto de respostas", async () => {
    const supabase = makeFakeSupabase(0, 60);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertSubmissionRate(supabase as any, "phase2_responses", "attempt-1"),
    ).rejects.toThrow("Limite de respostas");
  });
});
