import { describe, expect, it } from "vitest";
import { CONSENT_SECTIONS, CONSENT_VERSION, getConsentStatus } from "./consent";

function makeSupabase(row: { consent_version: string; accepted_at: string } | null) {
  return {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
      };
      return builder;
    },
  };
}

describe("CONSENT_SECTIONS", () => {
  it("cobre os itens obrigatórios do plano de correção (finalidade, serviços, prazo, acesso, exclusão, preparatória)", () => {
    const all = CONSENT_SECTIONS.map((s) => `${s.title} ${s.body}`).join(" ").toLowerCase();
    expect(all).toMatch(/preparatória/);
    expect(all).toMatch(/decea|anac/);
    expect(all).toMatch(/whisper|openai/);
    expect(all).toMatch(/claude|anthropic/);
    expect(all).toMatch(/30 dias/);
    expect(all).toMatch(/180 dias/);
    expect(all).toMatch(/e-mail/);
  });

  it("não fica vazio", () => {
    expect(CONSENT_SECTIONS.length).toBeGreaterThan(0);
  });
});

describe("getConsentStatus", () => {
  it("devolve accepted=false quando não há aceite da versão atual", async () => {
    const supabase = makeSupabase(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = await getConsentStatus(supabase as any, "user-1");
    expect(status).toEqual({ accepted: false, version: CONSENT_VERSION, acceptedAt: null });
  });

  it("devolve accepted=true com a data do aceite quando existe", async () => {
    const supabase = makeSupabase({ consent_version: CONSENT_VERSION, accepted_at: "2026-09-12T10:00:00Z" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = await getConsentStatus(supabase as any, "user-1");
    expect(status).toEqual({ accepted: true, version: CONSENT_VERSION, acceptedAt: "2026-09-12T10:00:00Z" });
  });
});
