// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mesma estratégia de pilot-track.test.ts: intercepta client.messages.create,
// mantém extractText/MODEL_VERSION reais.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/ai/anthropic-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/anthropic-client")>(
    "@/lib/ai/anthropic-client",
  );
  return { ...actual, client: { messages: { create } } };
});

function reply(text: string) {
  create.mockResolvedValueOnce({ content: [{ type: "text", text }] });
}

import { generateResponseFeedback, generateFinalReport } from "@/lib/ai/anthropic";

beforeEach(() => {
  create.mockReset();
});

describe("generateResponseFeedback", () => {
  it("devolve o texto extraído e manda a transcrição no corpo", async () => {
    reply("Clear and well structured.");
    const out = await generateResponseFeedback("Describe the situation.", "the runway is blocked");
    expect(out).toBe("Clear and well structured.");
    const { messages, model, thinking } = create.mock.calls[0][0];
    expect(model).toBe("claude-sonnet-5");
    expect(thinking).toEqual({ type: "disabled" });
    expect(messages[0].content).toContain("Pergunta: Describe the situation.");
    expect(messages[0].content).toContain("Resposta transcrita: the runway is blocked");
  });

  it("stage 'suggestion' injeta a regra e troca o rótulo do prompt", async () => {
    reply("ok");
    await generateResponseFeedback("situação X", "eu sugiro desviar", "suggestion");
    const { system, messages } = create.mock.calls[0][0];
    expect(system).toContain('"make a suggestion" step');
    expect(messages[0].content).toContain("Situação descrita pela IA (contexto): situação X");
  });

  it("stage 'story_telling' substitui o texto do prompt por frase neutra de tarefa", async () => {
    reply("ok");
    await generateResponseFeedback("Describe what you see in this image.", "once upon a time", "story_telling");
    const { system, messages } = create.mock.calls[0][0];
    expect(system).toContain('"tell a short story related to the image" step');
    expect(messages[0].content).toContain("Tell a short story related to the image you were shown.");
    expect(messages[0].content).not.toContain("Describe what you see in this image.");
  });

  it("sem stage usa o system base e o rótulo 'Pergunta'", async () => {
    reply("ok");
    await generateResponseFeedback("q", "a");
    const { system, messages } = create.mock.calls[0][0];
    expect(system).not.toContain('"make a suggestion" step');
    expect(messages[0].content).toContain("Pergunta: q");
  });
});

const strictJson = JSON.stringify({
  pronunciation: "good",
  structure: "moderate",
  vocabulary: "good",
  fluency: "good",
  comprehension: "good",
  interaction: "good",
  overall: "excellent",
  general_feedback: "cada critério explicado",
});

const transcripts = [
  { part: "part1", promptText: "P1", transcript: "resp 1", repetitionCount: 2 },
];

describe("generateFinalReport", () => {
  it("parseia JSON e força overall = menor dos 6", async () => {
    reply(strictJson);
    const out = await generateFinalReport(transcripts, "practice");
    expect(out.overall).toBe("moderate");
    expect(out.general_feedback).toBe("cada critério explicado");
  });

  it("remove cercas ```json antes de parsear", async () => {
    reply("```json\n" + strictJson + "\n```");
    const out = await generateFinalReport(transcripts, "practice");
    expect(out.overall).toBe("moderate");
  });

  it("cai no fallback quando o JSON é inválido", async () => {
    reply("não foi possível");
    const out = await generateFinalReport(transcripts, "practice");
    expect(out.overall).toBe("moderate");
    expect(out.general_feedback).toContain("suporte");
  });

  it("marca o número de repetições no corpo e aplica a regra de repetição do modo", async () => {
    reply(strictJson);
    await generateFinalReport(transcripts, "practice");
    const { system, messages } = create.mock.calls[0][0];
    expect(messages[0].content).toContain("pediu repetição 2x");
    expect(system).toContain("QUALQUER pedido de repetição");
  });

  it("official aplica a regra de repetição oficial", async () => {
    reply(strictJson);
    await generateFinalReport(transcripts, "official");
    const { system } = create.mock.calls[0][0];
    expect(system).toContain("MAIS DE UMA repetição");
  });
});
