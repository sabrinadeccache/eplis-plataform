import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PilotInterviewRunner } from "./pilot-interview-runner";
import { advanceState } from "@/services/simulations/pilot/actions";
import type { PilotSequence } from "@/services/simulations/pilot/queries";

vi.mock("@/services/simulations/pilot/actions", () => ({
  generateSpeech: vi.fn(async () => ({ audioBase64: "", mimeType: "audio/mpeg" })),
  advanceState: vi.fn(async () => ({ finished: false })),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// part1 com os 3 itens esperados por PART_SIZES do piloto (computeNextPosition
// usa esse tamanho fixo, não o length do array) — mesmo padrão do teste
// equivalente do controlador (interview-runner.test.tsx).
function makeSequence(): PilotSequence {
  const prompt = (id: string) => ({
    id,
    part: "part1" as const,
    promptText: `Prompt ${id}`,
    atcAudioText: null,
    expectedReadback: null,
    complicationText: null,
    complicationImageUrl: null,
    expectedReaction: null,
    atcFollowupAudioText: null,
    expectedConfirmation: null,
    discussionQuestion: null,
    discussionQuestion2: null,
    imageUrl: null,
    agreeDisagreeStatement: null,
    expectedDurationSeconds: 60,
  });
  return {
    part1: [prompt("p1-a"), prompt("p1-b"), prompt("p1-c")],
    part2: [],
    part3: [],
    part4: [],
  };
}

class FakeMediaRecorder {
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;

  constructor(stream: MediaStream) {
    this.stream = stream;
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"]) });
    this.onstop?.();
  }
}

beforeEach(() => {
  vi.clearAllMocks();

  Object.defineProperty(global.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    },
  });
  // @ts-expect-error stub simples só com o necessário pro fluxo testado
  global.MediaRecorder = FakeMediaRecorder;

  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ transcript: "ok", feedback: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Reproduz a corrida já documentada no InterviewRunner do controlador
// (goToNextItem): leva o item até a tela de feedback e dispara "Continuar"
// duas vezes quase ao mesmo tempo, como um duplo clique real faria.
async function driveItemToFeedback() {
  const audio = document.querySelector("audio") as HTMLAudioElement;
  await waitFor(() => expect(audio.src).toContain("data:audio/mpeg"));
  fireEvent(audio, new Event("ended"));

  fireEvent.click(await screen.findByRole("button", { name: "Falar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Concluir e enviar" }));
  await screen.findByRole("button", { name: "Continuar" });
}

describe("PilotInterviewRunner — trava de concorrência no avanço de item", () => {
  it("clique duplo em 'Continuar' no último item só chama advanceState uma vez", async () => {
    render(
      <PilotInterviewRunner
        attemptId="attempt-1"
        mode="practice"
        sequence={makeSequence()}
        initialPart="part1"
        initialItemIndex={1}
      />,
    );

    await driveItemToFeedback();

    const continueButton = screen.getByRole("button", { name: "Continuar" });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);

    await waitFor(() => expect(advanceState).toHaveBeenCalled());
    expect(advanceState).toHaveBeenCalledTimes(1);
  });
});
