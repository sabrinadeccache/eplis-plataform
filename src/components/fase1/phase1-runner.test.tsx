import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Phase1Runner } from "./phase1-runner";
import { recordAnswer, finishAttempt } from "@/services/simulations/phase1/actions";
import type { Phase1QuizItem } from "@/services/simulations/phase1/queries";

vi.mock("@/services/simulations/phase1/actions", () => ({
  recordAnswer: vi.fn(async () => {}),
  finishAttempt: vi.fn(async () => {}),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function makeQuestion(id: string): Phase1QuizItem {
  return {
    id,
    audioUrl: `https://example.com/${id}.mp3`,
    prompt: `Prompt ${id}`,
    optionA: "A",
    optionB: "B",
    optionC: "C",
  };
}

// Leva o runner da fase "reading" (estado inicial) até "answering", onde o
// botão "Confirmar e avançar"/"Finalizar simulado" fica disponível — sem
// depender dos timers reais de 30s/60s.
async function advanceToAnswering() {
  fireEvent.click(screen.getByRole("button", { name: "Ouvir áudio" }));
  const audio = document.querySelector("audio");
  if (!audio) throw new Error("audio element not found");
  fireEvent.ended(audio);
  await screen.findByText(/Tempo para responder/);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Phase1Runner — trava de concorrência no avanço", () => {
  it("retoma no índice derivado das respostas persistidas", () => {
    render(
      <Phase1Runner
        attemptId="attempt-1"
        questions={[makeQuestion("q1"), makeQuestion("q2"), makeQuestion("q3")]}
        startIndex={1}
      />,
    );
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("Prompt q2")).toBeInTheDocument();
  });

  it("clique duplo no botão de avanço não pula uma questão nem chama recordAnswer duas vezes", async () => {
    render(
      <Phase1Runner attemptId="attempt-1" questions={[makeQuestion("q1"), makeQuestion("q2")]} />,
    );

    await advanceToAnswering();
    fireEvent.click(screen.getByLabelText("A"));

    const advanceButton = screen.getByRole("button", { name: "Confirmar e avançar" });
    fireEvent.click(advanceButton);
    fireEvent.click(advanceButton);

    await waitFor(() => expect(screen.getByText("2/2")).toBeInTheDocument());

    expect(recordAnswer).toHaveBeenCalledTimes(1);
  });

  it("clique duplo na última questão só finaliza a tentativa uma vez", async () => {
    render(<Phase1Runner attemptId="attempt-1" questions={[makeQuestion("q1")]} />);

    await advanceToAnswering();

    const finishButton = screen.getByRole("button", { name: "Finalizar simulado" });
    fireEvent.click(finishButton);
    fireEvent.click(finishButton);

    await waitFor(() => expect(finishAttempt).toHaveBeenCalled());

    expect(finishAttempt).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it("persiste uma resposta incorreta mesmo quando avança sem seleção", async () => {
    render(<Phase1Runner attemptId="attempt-1" questions={[makeQuestion("q1")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvir áudio" }));
    fireEvent.ended(document.querySelector("audio")!);
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar simulado" }));
    await waitFor(() => expect(recordAnswer).toHaveBeenCalledWith("attempt-1", "q1", null));
  });
});
