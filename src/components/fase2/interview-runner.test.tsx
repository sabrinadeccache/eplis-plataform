import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InterviewRunner } from "./interview-runner";
import { advanceState } from "@/services/simulations/phase2/actions";
import type { Phase2Sequence } from "@/services/simulations/phase2/queries";

vi.mock("@/services/simulations/phase2/actions", () => ({
  generateSpeech: vi.fn(async () => ({ audioBase64: "", mimeType: "audio/mpeg" })),
  advanceState: vi.fn(async () => ({ finished: false })),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// part1 com os 4 itens esperados por PART_SIZES (computeNextPosition usa esse
// tamanho fixo, não o length do array) — evita cair num item inexistente ao
// avançar. As outras partes ficam vazias porque o teste nunca cruza pra lá
// (item inicial não é o último da parte).
function makeSequence(): Phase2Sequence {
  const prompt = (id: string) => ({
    id,
    part: "part1" as const,
    promptText: `Prompt ${id}`,
    imageUrl: null,
    expectedDurationSeconds: 30,
  });
  return {
    part1: [prompt("p1-a"), prompt("p1-b"), prompt("p1-c"), prompt("p1-d")],
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

// Reproduz a corrida documentada em interview-runner.tsx (goToNextItem):
// leva o item até a tela de feedback e dispara "Continuar" duas vezes quase
// ao mesmo tempo, como um duplo clique real faria.
async function driveItemToFeedback() {
  // Sem áudio real em jsdom, a IA nunca dispara "ended" sozinha — precisamos
  // simular o fim da fala manualmente assim que o `src` (gerado a partir do
  // generateSpeech mockado) for atribuído ao elemento persistente.
  const audio = document.querySelector("audio") as HTMLAudioElement;
  await waitFor(() => expect(audio.src).toContain("data:audio/mpeg"));
  fireEvent(audio, new Event("ended"));

  fireEvent.click(await screen.findByRole("button", { name: "Falar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Concluir e enviar" }));
  await screen.findByRole("button", { name: "Continuar" });
}

describe("InterviewRunner — trava de concorrência no avanço de item", () => {
  it("clique duplo em 'Continuar' no último item só chama advanceState uma vez", async () => {
    render(
      <InterviewRunner
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
