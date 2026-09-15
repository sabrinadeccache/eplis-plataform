import { describe, expect, it } from "vitest";
import { assertAccountStillActive } from "./attempt-guards";

function makeAdmin(status: string | null | undefined, opts: { queryFails?: boolean } = {}) {
  return {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (opts.queryFails) return { data: null, error: { message: "boom" } };
          if (status === undefined) return { data: null, error: null };
          return { data: { status }, error: null };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Achado da revisão (2026-09-12, M3): bloqueio de conta em purgeUserRecordings
// não parava requisição já em voo. Esta função é a 2ª checagem, chamada logo
// antes de persistir conteúdo nas rotas de submit-response — ver comentário
// em attempt-guards.ts.
describe("assertAccountStillActive", () => {
  it("passa quando a conta está active", async () => {
    await expect(assertAccountStillActive(makeAdmin("active"), "u1")).resolves.toBeUndefined();
  });

  it("rejeita quando a conta foi bloqueada (exclusão em andamento)", async () => {
    await expect(assertAccountStillActive(makeAdmin("blocked"), "u1")).rejects.toThrow();
  });

  it("rejeita quando a conta não existe mais (já excluída)", async () => {
    await expect(assertAccountStillActive(makeAdmin(undefined), "u1")).rejects.toThrow();
  });

  it("rejeita (fecha fechado) se a consulta falhar", async () => {
    await expect(assertAccountStillActive(makeAdmin("active", { queryFails: true }), "u1")).rejects.toThrow();
  });
});
