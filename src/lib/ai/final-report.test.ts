// @vitest-environment node
import { describe, it, expect } from "vitest";
import { normalizeFinalReport, type FinalReport } from "@/lib/ai/anthropic";
import { lowestProficiency } from "@/types/database";

const base: FinalReport = {
  pronunciation: "good",
  structure: "good",
  vocabulary: "good",
  fluency: "good",
  comprehension: "good",
  interaction: "good",
  overall: "good",
  general_feedback: "ok",
};

describe("lowestProficiency", () => {
  it("retorna a faixa mais baixa entre as fornecidas", () => {
    expect(lowestProficiency(["excellent", "good", "moderate"])).toBe("moderate");
    expect(lowestProficiency(["excellent", "excellent"])).toBe("excellent");
    expect(lowestProficiency(["weak", "excellent"])).toBe("weak");
  });
});

describe("normalizeFinalReport", () => {
  it("força overall = menor dos 6 critérios, ignorando o que o modelo mandou", () => {
    const out = normalizeFinalReport({ ...base, comprehension: "weak", overall: "excellent" });
    expect(out.overall).toBe("weak");
  });

  it("aceita a faixa nova 'excellent'", () => {
    const out = normalizeFinalReport({
      ...base,
      pronunciation: "excellent",
      structure: "excellent",
      vocabulary: "excellent",
      fluency: "excellent",
      comprehension: "excellent",
      interaction: "excellent",
      overall: "good",
    });
    expect(out.overall).toBe("excellent");
  });

  it("substitui valor de faixa desconhecido por 'moderate'", () => {
    const out = normalizeFinalReport({ ...base, vocabulary: "amazing" as never });
    expect(out.vocabulary).toBe("moderate");
    expect(out.overall).toBe("moderate");
  });
});
