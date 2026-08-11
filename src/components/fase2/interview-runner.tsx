"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateSpeech, advanceState } from "@/services/simulations/phase2/actions";
import { computeNextPosition } from "@/services/simulations/phase2/state-machine";
import type { Phase2Sequence, Phase2Prompt } from "@/services/simulations/phase2/queries";
import type { Part, ResponseStage, SimulationMode } from "@/types/database";

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

// Timer de início de resposta (modo official): pra ser fiel ao exame real (a
// pedido da Sabrina — sem botão "Falar" manual), a gravação começa sozinha depois
// de 5s de pausa, sem exigir clique do candidato. Distinto do timer de duração da
// resposta (não implementado nesta rodada — decisão de escopo, ver
// docs/project-status.md). Mesmo padrão do SilentTimer: remonta via `key`,
// decrementa em setTimeout, delega o disparo a um callback opaco.
function ResponseStartTimer({ seconds, onExpire }: { seconds: number; onExpire: () => void }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onExpire();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, onExpire]);

  return (
    <p className="text-sm text-amber-600 dark:text-amber-400">
      A gravação começa automaticamente em {remaining}s…
    </p>
  );
}

type RecorderState = "waiting_ai" | "ready" | "recording" | "paused" | "submitting" | "feedback";

function stepKey(part: Part, itemIndex: number, stepIndex: number): string {
  return `${part}-${itemIndex}-${stepIndex}`;
}

// Bloqueio de autoplay do navegador (ex.: entrando direto numa URL da
// entrevista, sem nenhuma interação prévia na página) rejeita `audio.play()`
// com esse erro específico — distinguimos de outras falhas (rede, etc.) pra
// só mostrar o botão "ativar áudio" quando for realmente isso.
function isAutoplayBlocked(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}

export function InterviewRunner({
  attemptId,
  mode,
  sequence,
  initialPart,
  initialItemIndex,
}: {
  attemptId: string;
  mode: SimulationMode;
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
  const [awaitingFeedbackSpeech, setAwaitingFeedbackSpeech] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

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
      setAwaitingFeedbackSpeech(false);
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
      setAwaitingFeedbackSpeech(false);
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
        audio.play().catch((err) => {
          if (cancelled) return;
          if (isAutoplayBlocked(err)) setAudioBlocked(true);
          onFinished();
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

  // Clique real do usuário — o navegador aceita isso como gesto válido pra
  // desbloquear autoplay no elemento de áudio daqui em diante, mesmo que o
  // conteúdo atual do `src` já tenha "terminado" (foi só o play() que falhou).
  function unlockAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    audio
      .play()
      .then(() => setAudioBlocked(false))
      .catch(() => {});
  }

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
      startTransition(async () => {
        // Upload via multipart/form-data numa route handler comum, NÃO uma
        // Server Action — o áudio em base64 como argumento de Server Action
        // estourava o limite interno de decodificação do protocolo Flight
        // ("Maximum array nesting exceeded") em respostas mais longas, como a
        // história da Parte 4 (achado real, erro 500 reproduzido). Ver
        // src/app/api/phase2/submit-response/route.ts.
        const formData = new FormData();
        formData.append("attemptId", attemptId);
        formData.append("promptId", currentPrompt.id);
        formData.append("stage", currentStep.stage as ResponseStage);
        formData.append("repetitionCount", String(repetitionCount));
        formData.append("audio", blob, `audio.${blob.type.includes("mp4") ? "mp4" : "webm"}`);

        const res = await fetch("/api/phase2/submit-response", { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Não foi possível enviar a resposta.");
        }
        const result = (await res.json()) as { transcript: string; feedback: string | null };

        // Modo official não dá nenhum feedback durante a entrevista (só o
        // relatório final) — pula direto pro próximo estágio/item, sem card nem
        // áudio de feedback.
        if (mode === "official") {
          goToNextStep();
          return;
        }

        setFeedback(result.feedback);
        setRecorderState("feedback");

        // A IA "fala" o feedback, como um entrevistador de verdade, além de
        // mostrar o texto na tela. O botão "Continuar" fica bloqueado
        // (awaitingFeedbackSpeech) enquanto esse áudio é gerado e tocado —
        // sem isso, dava pra clicar antes do áudio começar ou no meio dele,
        // cortando o feedback e emendando direto na próxima pergunta.
        if (result.feedback) {
          setAwaitingFeedbackSpeech(true);
          try {
            const speech = await generateSpeech(result.feedback);
            const audio = audioRef.current;
            if (!audio) {
              setAwaitingFeedbackSpeech(false);
              return;
            }
            const onDone = () => {
              setAwaitingFeedbackSpeech(false);
              audio.removeEventListener("ended", onDone);
              audio.removeEventListener("error", onDone);
            };
            audio.addEventListener("ended", onDone);
            audio.addEventListener("error", onDone);
            audio.src = `data:${speech.mimeType};base64,${speech.audioBase64}`;
            audio.play().catch((err) => {
              if (isAutoplayBlocked(err)) setAudioBlocked(true);
              onDone();
            });
          } catch {
            setAwaitingFeedbackSpeech(false);
          }
        }
      });
    });
  }

  return (
    <div className="space-y-6">
      <audio ref={audioRef} />

      {audioBlocked && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span>
            O navegador bloqueou o áudio automático da IA (comum ao abrir a entrevista direto por
            um link, sem nenhum clique antes). Clique para ativar.
          </span>
          <button
            type="button"
            onClick={unlockAudio}
            className="shrink-0 rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-amber-200 dark:text-amber-950"
          >
            🔊 Ativar áudio
          </button>
        </div>
      )}

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Parte {part.replace("part", "")} — item {itemIndex + 1}
      </p>

      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        {part === "part4" && currentPrompt.imageUrl && (
          // Visível durante todo o item da Parte 4 (observação, descrição e a
          // história) — o candidato precisa poder olhar pra imagem de novo ao
          // contar a história, não só durante a observação inicial.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentPrompt.imageUrl}
            alt="Imagem para descrição e história"
            className="mb-4 max-h-96 w-full rounded-md object-contain"
          />
        )}

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

            {recorderState === "ready" && mode === "official" && (
              // Fiel ao exame real: sem botão "Falar" manual — a gravação começa
              // sozinha depois da pausa de 5s.
              <div className="space-y-2">
                {/* Some enquanto o áudio da pergunta toca (inclusive ao repetir) — o
                    componente desmonta (limpando o setTimeout interno) e remonta com
                    5s cheios de novo assim que a fala termina, via o `speaking`
                    global já usado pro indicador "IA está falando". */}
                {!speaking && (
                  <ResponseStartTimer
                    key={stepKey(part, itemIndex, stepIndex)}
                    seconds={5}
                    onExpire={startRecording}
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={replayAudio}
                    disabled={repetitionCount >= 1}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    Repetir pergunta
                  </button>
                </div>
              </div>
            )}

            {recorderState === "ready" && mode === "practice" && (
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
                {mode === "practice" && (
                  // Official é fiel ao exame real: sem segunda chance, então sem
                  // "Recomeçar" — só practice mantém esse botão.
                  <button
                    type="button"
                    onClick={restartRecording}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    Recomeçar
                  </button>
                )}
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
                {awaitingFeedbackSpeech ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Aguarde a IA terminar de falar o feedback…
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={goToNextStep}
                    className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    Continuar
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
