// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OFFICIAL_MODE_ADDENDUM } from "@/lib/ai/anthropic";

// Captura os argumentos de cada chamada e devolve um texto configurável, sem
// tocar na API real da Anthropic. `extractText` e `MODEL_VERSION` continuam os
// de verdade (não têm regra de negócio).
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/ai/anthropic-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/anthropic-client")>(
    "@/lib/ai/anthropic-client",
  );
  return {
    ...actual,
    client: { messages: { create } },
  };
});

function reply(text: string) {
  create.mockResolvedValueOnce({ content: [{ type: "text", text }] });
}

import {
  generatePilotResponseFeedback,
  generatePilotFinalReport,
} from "@/lib/ai/pilot-track";

beforeEach(() => {
  create.mockReset();
});

describe("generatePilotResponseFeedback", () => {
  it("devolve o texto extraído da resposta do modelo", async () => {
    reply("Good, clear readback.");
    const out = await generatePilotResponseFeedback("ctx", "transcript");
    expect(out).toBe("Good, clear readback.");
  });

  it("passa modelo real e desliga thinking", async () => {
    reply("ok");
    await generatePilotResponseFeedback("ctx", "t");
    const args = create.mock.calls[0][0];
    expect(args.model).toBe("claude-sonnet-5");
    expect(args.thinking).toEqual({ type: "disabled" });
    expect(args.messages[0].content).toContain("transcrita: t");
  });

  it("injeta a regra da etapa no system quando stage é informado", async () => {
    reply("ok");
    await generatePilotResponseFeedback("ctx", "t", "readback");
    const { system } = create.mock.calls[0][0];
    expect(system).toContain('"readback" step');
    expect(system).toContain("must respond in role, as the\npilot");
  });

  it("não injeta regra de etapa quando stage é omitido", async () => {
    reply("ok");
    await generatePilotResponseFeedback("ctx", "t");
    const { system } = create.mock.calls[0][0];
    expect(system).not.toContain('"readback" step');
  });

  it("stage desconhecido não quebra e cai no system base", async () => {
    reply("ok");
    await generatePilotResponseFeedback("ctx", "t", "nope" as never);
    const { system } = create.mock.calls[0][0];
    expect(system).toContain("Santos Dumont English Assessment");
    expect(system).not.toContain('"readback" step');
  });
});

const strictJson = JSON.stringify({
  pronunciation: "good",
  structure: "good",
  vocabulary: "weak",
  fluency: "good",
  comprehension: "good",
  interaction: "good",
  overall: "excellent",
  general_feedback: "detalhe por critério",
});

const transcripts = [
  { part: "part2", promptText: "situação", transcript: "resposta do piloto", repetitionCount: 0 },
];

describe("generatePilotFinalReport", () => {
  it("parseia JSON estrito e força overall = menor dos 6", async () => {
    reply(strictJson);
    const out = await generatePilotFinalReport(transcripts, "practice");
    expect(out.overall).toBe("weak");
    expect(out.general_feedback).toBe("detalhe por critério");
  });

  it("remove cercas de código ```json antes de parsear", async () => {
    reply("```json\n" + strictJson + "\n```");
    const out = await generatePilotFinalReport(transcripts, "practice");
    expect(out.overall).toBe("weak");
  });

  it("cai no relatório de fallback quando o JSON é inválido", async () => {
    reply("desculpa, não consegui");
    const out = await generatePilotFinalReport(transcripts, "practice");
    expect(out.overall).toBe("moderate");
    expect(out.general_feedback).toContain("suporte");
  });

  it("modo official adiciona o adendo de modo oficial ao system", async () => {
    reply(strictJson);
    await generatePilotFinalReport(transcripts, "official");
    const { system } = create.mock.calls[0][0];
    expect(system).toContain(OFFICIAL_MODE_ADDENDUM.trim().slice(0, 30));
  });

  it("practice não adiciona o adendo de modo oficial", async () => {
    reply(strictJson);
    await generatePilotFinalReport(transcripts, "practice");
    const { system } = create.mock.calls[0][0];
    expect(system).not.toContain(OFFICIAL_MODE_ADDENDUM.trim().slice(0, 30));
  });

  it("numera cada resposta e inclui parte/contexto/transcrição no corpo", async () => {
    reply(strictJson);
    await generatePilotFinalReport(
      [
        { part: "part2", promptText: "A", transcript: "resp A" },
        { part: "part3", promptText: "B", transcript: "resp B" },
      ],
      "practice",
    );
    const body = create.mock.calls[0][0].messages[0].content;
    expect(body).toContain("[1] (part2) Contexto: A");
    expect(body).toContain("[2] (part3) Contexto: B");
    expect(body).toContain("resp B");
  });
});
