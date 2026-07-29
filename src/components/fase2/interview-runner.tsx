"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateSpeech, submitResponse, advanceState } from "@/services/simulations/phase2/actions";
import { computeNextPosition } from "@/services/simulations/phase2/state-machine";
import type { Phase2Sequence, Phase2Prompt } from "@/services/simulations/phase2/queries";
import type { Part, ResponseStage } from "@/types/database";

// Tudo que a IA fala é em inglês (inclusive introduções/instruções) — o
// aluno já deve treinar o ouvido em inglês antes do exame de verdade.
const PART_INTRO_TEXT: Record<Part, string> = {
  part1: "Let's begin Part 1. I will ask you a few personal questions about yourself and your work.",
  part2: "Now Part 2. I will describe operational situations. First, you'll tell me what the situation is, and then you'll make a suggestion.",
  part3: "Part 3. Now some more open questions about your field of work.",
  part4: "The last part. You will see an image. Describe it, and then tell a short story related to it.",
};

type StepKind = "auto" | "silent" | "response";
type Step = { stage: ResponseStage | "intro"; kind: StepKind; durationSeconds?: number; text: string };

function buildSteps(part: Part, itemIndex: number, prompt: Phase2Prompt): Step[] {
  const steps: Step[] = [];
  if (itemIndex === 0) {
    steps.push({ stage: "intro", kind: "auto", durationSeconds: 3, text: PART_INTRO_TEXT[part] });
  }

  if (part === "part1" || part === "part3") {
    steps.push({ stage: "main", kind: "response", text: prompt.promptText });
    return steps;
  }

  if (part === "part2") {
    steps.push({
      stage: "situation_check",
      kind: "response",
      text: prompt.promptText,
    });
    steps.push({
      stage: "suggestion",
      kind: "response",
      text: "Make a suggestion.",
    });
    return steps;
  }

  // part4
  steps.push({
    stage: "image_observation",
    kind: "silent",
    durationSeconds: 15,
    text: "Observe the image for 15 seconds.",
  });
  steps.push({ stage: "image_description", kind: "response", text: prompt.promptText });
  steps.push({
    stage: "story_preparation",
    kind: "silent",
    durationSeconds: 30,
    text: "Prepare a short story related to the image. You will have 30 seconds to prepare.",
  });
  steps.push({
    stage: "story_telling",
    kind: "response",
    text: "Now tell your story related to the image.",
  });
  return steps;
}

function pickPrompt(sequence: Phase2Sequence, part: Part, itemIndex: number): Phase2Prompt {
  return sequence[part][itemIndex];
}

function stepAt(sequence: Phase2Sequence, part: Part, itemIndex: number, stepIndex: number): Step {
  const prompt = pickPrompt(sequence, part, itemIndex);
  return buildSteps(part, itemIndex, prompt)[stepIndex];
}

// Timer de estágio silencioso (observação de imagem / preparação de história).
// Mesmo padrão do componente `Countdown` do phase1-runner: remonta via `key`
// a cada estágio, decrementa dentro de um setTimeout (não sincronamente no
// corpo do effect) e delega o avanço a um callback opaco (`onExpire`).
function SilentTimer({ seconds, onExpire }: { seconds: number; onExpire: () => void }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onExpire();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, onExpire]);

  return <p className="text-sm text-zinc-500 dark:text-zinc-400">{remaining}s restantes…</p>;
}

type RecorderState = "waiting_ai" | "ready" | "recording" | "paused" | "submitting" | "feedback";

function stepKey(part: Part, itemIndex: number, stepIndex: number): string {
  return `${part}-${itemIndex}-${stepIndex}`;
}

export function InterviewRunner({
  attemptId,
  sequence,
  initialPart,
  initialItemIndex,
}: {
  attemptId: string;
  sequence: Phase2Sequence;
  initialPart: Part;
  initialItemIndex: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [part, setPart] = useState<Part>(initialPart);
  const [itemIndex, setItemIndex] = useState(initialItemIndex);
  const [stepIndex, setStepIndex] = useState(0);
  const [repetitionCount, setRepetitionCount] = useState(0);

  const [speaking, setSpeaking] = useState(false);
  const [ttsEnded, setTtsEnded] = useState(false);
  const [recorderState, setRecorderState] = useState<RecorderState>("waiting_ai");
  const [feedback, setFeedback] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const currentPrompt = pickPrompt(sequence, part, itemIndex);
  const steps = buildSteps(part, itemIndex, currentPrompt);
  const currentStep = steps[stepIndex];

  const goToNextItem = useCallback(() => {
    startTransition(async () => {
      const result = await advanceState(attemptId);
      if (result.finished) {
        router.push(`/fase2/resultado/${attemptId}`);
        return;
      }
      const next = computeNextPosition(part, itemIndex);
      if (!next) return;
      setPart(next.part);
      setItemIndex(next.itemIndex);
      setStepIndex(0);
      setRepetitionCount(0);
      setRecorderState("waiting_ai");
      setTtsEnded(false);
      setFeedback(null);
      chunksRef.current = [];
    });
  }, [attemptId, part, itemIndex, router, startTransition]);

  const goToNextStepRef = useRef<() => void>(() => {});
  const goToNextStep = useCallback(() => {
    if (stepIndex + 1 < steps.length) {
      setStepIndex((i) => i + 1);
      setRecorderState("waiting_ai");
      setTtsEnded(false);
      setFeedback(null);
      setRepetitionCount(0);
      chunksRef.current = [];
    } else {
      goToNextItem();
    }
  }, [stepIndex, steps.length, goToNextItem]);
  useEffect(() => {
    goToNextStepRef.current = goToNextStep;
  }, [goToNextStep]);

  // Indicador "IA está falando" — desacoplado da lógica de transição de
  // estágio abaixo, registrado uma única vez no elemento <audio> persistente.
  // Assim ele também reflete corretamente o áudio do feedback (tocado depois
  // do envio da resposta), sem risco de travar em `true` para sempre.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    function onPlaying() {
      setSpeaking(true);
    }
    function onStopped() {
      setSpeaking(false);
    }
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("ended", onStopped);
    audio.addEventListener("pause", onStopped);
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("ended", onStopped);
      audio.removeEventListener("pause", onStopped);
    };
  }, []);

  // Busca e toca o áudio da IA para o estágio atual, sempre no MESMO elemento
  // <audio> persistente (nunca remontado) — usar um elemento novo a cada
  // estágio faz o navegador bloquear o autoplay depois do primeiro, travando
  // a tela esperando um evento `ended` que nunca chega. Se o autoplay for
  // bloqueado mesmo assim, o catch trata como "terminou de falar" na hora,
  // em vez de deixar a UI presa.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const step = stepAt(sequence, part, itemIndex, stepIndex);
    let finished = false;
    let advanceTimeout: ReturnType<typeof setTimeout> | undefined;

    function onFinished() {
      if (finished) return;
      finished = true;
      if (step.kind === "response") {
        setRecorderState("ready");
      } else if (step.kind === "auto") {
        advanceTimeout = setTimeout(() => goToNextStepRef.current(), 3000);
      } else {
        setTtsEnded(true);
      }
    }

    audio.addEventListener("ended", onFinished);
    audio.addEventListener("error", onFinished);

    let cancelled = false;
    generateSpeech(step.text)
      .then(({ audioBase64, mimeType }) => {
        if (cancelled) return;
        audio.src = `data:${mimeType};base64,${audioBase64}`;
        audio.play().catch(() => {
          if (!cancelled) onFinished();
        });
      })
      .catch(() => {
        if (!cancelled) onFinished();
      });

    return () => {
      cancelled = true;
      if (advanceTimeout) clearTimeout(advanceTimeout);
      audio.removeEventListener("ended", onFinished);
      audio.removeEventListener("error", onFinished);
    };
  }, [part, itemIndex, stepIndex, sequence]);

  function replayAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    setRepetitionCount((c) => c + 1);
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    setRecorderState("recording");
  }

  function pauseRecording() {
    mediaRecorderRef.current?.pause();
    setRecorderState("paused");
  }

  function resumeRecording() {
    mediaRecorderRef.current?.resume();
    setRecorderState("recording");
  }

  function restartRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => recorder.stream.getTracks().forEach((t) => t.stop());
      recorder.stop();
    }
    chunksRef.current = [];
    setRecorderState("ready");
  }

  function stopRecorderAndGetBlob(): Promise<Blob> {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      const mimeType = recorder?.mimeType || "audio/webm";
      if (!recorder || recorder.state === "inactive") {
        resolve(new Blob(chunksRef.current, { type: mimeType }));
        return;
      }
      recorder.onstop = () => {
        recorder.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunksRef.current, { type: mimeType }));
      };
      recorder.stop();
    });
  }

  function finishAndSubmit() {
    setRecorderState("submitting");
    stopRecorderAndGetBlob().then((blob) => {
      const mimeType = blob.type || "audio/webm";
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const audioBase64 = dataUrl.split(",")[1] ?? "";
        startTransition(async () => {
          const result = await submitResponse(
            attemptId,
            currentPrompt.id,
            currentStep.stage as ResponseStage,
            audioBase64,
            mimeType,
            repetitionCount,
          );
          setFeedback(result.feedback);
          setRecorderState("feedback");

          // A IA "fala" o feedback, como um entrevistador de verdade, além de
          // mostrar o texto na tela.
          if (result.feedback) {
            const speech = await generateSpeech(result.feedback);
            const audio = audioRef.current;
            if (audio) {
              audio.src = `data:${speech.mimeType};base64,${speech.audioBase64}`;
              audio.play().catch(() => {});
            }
          }
        });
      };
      reader.readAsDataURL(blob);
    });
  }

  return (
    <div className="space-y-6">
      <audio ref={audioRef} />

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Parte {part.replace("part", "")} — item {itemIndex + 1}
      </p>

      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        {speaking && (
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">🔊 A IA está falando…</p>
        )}

        {currentStep.kind === "silent" && ttsEnded && (
          <SilentTimer
            key={stepKey(part, itemIndex, stepIndex)}
            seconds={currentStep.durationSeconds ?? 15}
            onExpire={goToNextStep}
          />
        )}

        {currentStep.kind === "response" && (
          <div className="space-y-4">
            {recorderState === "waiting_ai" && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Aguarde a IA terminar de falar…</p>
            )}

            {recorderState === "ready" && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={startRecording}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Falar
                </button>
                <button
                  type="button"
                  onClick={replayAudio}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Repetir pergunta
                </button>
              </div>
            )}

            {(recorderState === "recording" || recorderState === "paused") && (
              <div className="flex flex-wrap gap-2">
                {recorderState === "recording" ? (
                  <button
                    type="button"
                    onClick={pauseRecording}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    Pausar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={resumeRecording}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    Continuar falando
                  </button>
                )}
                <button
                  type="button"
                  onClick={restartRecording}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Recomeçar
                </button>
                <button
                  type="button"
                  onClick={finishAndSubmit}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Concluir e enviar
                </button>
              </div>
            )}

            {recorderState === "submitting" && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Transcrevendo e avaliando sua resposta…
              </p>
            )}

            {recorderState === "feedback" && (
              <div className="space-y-3">
                <p className="rounded-md bg-zinc-100 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {feedback}
                </p>
                <button
                  type="button"
                  onClick={goToNextStep}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Continuar
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
