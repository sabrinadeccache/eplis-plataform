import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Phase1PracticeRunner } from "./phase1-practice-runner";
import { recordAnswer, finishAttempt } from "@/services/simulations/phase1/actions";
import type { Phase1QuizItem } from "@/services/simulations/phase1/queries";

vi.mock("@/services/simulations/phase1/actions", () => ({
  recordAnswer: vi.fn(async () => ({
    isCorrect: false,
    correctOption: "b",
    transcript: "Mayday, mayday, mayday, ABC123.",
  })),
  finishAttempt: vi.fn(async () => ({ score: 0 })),
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

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

function listenThenPick(optionLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: "Ouvir áudio" }));
  fireEvent.click(screen.getByLabelText(optionLabel));
}

describe("Phase1PracticeRunner", () => {
  it("revela resposta certa e transcrição só depois de responder, e avança", async () => {
    render(
      <Phase1PracticeRunner
        attemptId="a1"
        questions={[makeQuestion("q1"), makeQuestion("q2")]}
      />,
    );

    // Antes de responder: sem transcrição na tela.
    expect(screen.queryByText(/Transcrição do áudio/)).not.toBeInTheDocument();

    listenThenPick("A");
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));

    await screen.findByText(/Transcrição do áudio/);
    expect(recordAnswer).toHaveBeenCalledWith("a1", "q1", "a");
    expect(screen.getByText("Não foi dessa vez.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima questão" }));
    await waitFor(() => expect(screen.getByText("2/2")).toBeInTheDocument());
  });

  it("na última questão, finaliza uma vez só mesmo com clique duplo", async () => {
    render(<Phase1PracticeRunner attemptId="a1" questions={[makeQuestion("q1")]} />);

    listenThenPick("B");
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    await screen.findByRole("button", { name: "Ver resultado" });

    const done = screen.getByRole("button", { name: "Ver resultado" });
    fireEvent.click(done);
    fireEvent.click(done);

    await waitFor(() => expect(finishAttempt).toHaveBeenCalled());
    expect(finishAttempt).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});
