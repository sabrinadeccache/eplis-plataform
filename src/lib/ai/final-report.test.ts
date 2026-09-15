// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  normalizeFinalReport,
  repetitionMarker,
  repetitionRuleFor,
  type FinalReport,
} from "@/lib/ai/anthropic";
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
  it("usa o menor dos quatro critérios textuais e marca os acústicos indisponíveis", () => {
    const out = normalizeFinalReport({ ...base, comprehension: "weak", overall: "excellent" });
    expect(out.overall).toBe("weak");
    expect(out.pronunciation).toBeNull();
    expect(out.fluency).toBeNull();
  });

  it("não deixa uma pseudo-nota acústica determinar o overall", () => {
    const out = normalizeFinalReport({ ...base, pronunciation: "weak", fluency: "weak" });
    expect(out.overall).toBe("good");
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

  it("não inventa N4 quando um critério recebido é inválido", () => {
    const out = normalizeFinalReport({ ...base, vocabulary: "amazing" as never });
    expect(out.vocabulary).toBeNull();
    expect(out.overall).toBeNull();
  });
});

describe("repetitionMarker", () => {
  it("marca só quando houve pelo menos uma repetição", () => {
    expect(repetitionMarker(0)).toBe("");
    expect(repetitionMarker(undefined)).toBe("");
    expect(repetitionMarker(null)).toBe("");
    expect(repetitionMarker(2)).toContain("2x");
  });
});

describe("repetitionRuleFor", () => {
  it("practice penaliza qualquer repetição; official só mais de uma", () => {
    expect(repetitionRuleFor("practice")).toContain("QUALQUER pedido de repetição");
    expect(repetitionRuleFor("official")).toContain("MAIS DE UMA repetição");
  });

  it("os dois modos protegem quem demonstrou Ótimo/Excelente", () => {
    for (const mode of ["practice", "official"] as const) {
      expect(repetitionRuleFor(mode)).toContain('NÃO rebaixe COMPREENSÃO abaixo de "good"');
    }
  });
});
