"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateSpeech, advanceState } from "@/services/simulations/pilot/actions";
import { computeNextPosition, PART_SIZES } from "@/services/simulations/pilot/state-machine";
import { hashStringToSeed } from "@/lib/prng";
import type { PilotSequence, PilotPrompt } from "@/services/simulations/pilot/queries";
import type { Part, PilotResponseStage, SimulationMode } from "@/types/database";
import { AudioOrb, type OrbState } from "@/components/interview/audio-orb";
import {
  InterviewStrip,
  RecLight,
  StatusLine,
  KeyDeck,
  KeyButton,
  DeckSpacer,
  DeckNote,
  formatElapsed,
  createMicAnalyser,
} from "@/components/interview/interview-ui";

// Fork dedicado do InterviewRunner do controlador (src/components/fase2/interview-runner.tsx)
// — a Parte 2 do piloto é um role-play com sub-estágios genuinamente diferentes
// (readback/reação/confirmação/discurso indireto vs. situation_check/suggestion do
// controlador), decisão já fechada de não forçar isso na state machine existente. O
// padrão de gravação/TTS/timers abaixo é reaproveitado por releitura direta do
// componente do controlador (mesma engenharia já validada em produção), não por
// import — ver plano de implementação.
const PART_INTRO_TEXT: Record<Part, string> = {
  part1: "Let's begin Part 1. I will ask you a few questions about your career and aviation in general.",
  part2:
    "Now Part 2. You are the pilot of a twin-engined aircraft, call sign LEVEL 6. I will describe five situations — listen to the controller, read back the instruction, and react appropriately.",
  part3:
    "Part 3. You will hear three unexpected situations between a pilot and a controller. Listen carefully, then tell me what you heard.",
  part4: "The last part. You will see a picture. Describe it, and then we'll discuss it.",
};

type StepKind = "auto" | "response";
type Step = {
  stage: PilotResponseStage | "intro";
  kind: StepKind;
  durationSeconds?: number;
  text: string;
  // Parte 2 (falas do ATC) e Parte 3 (gravação piloto/controlador): áudio
  // pré-gerado com efeito de rádio. Quando presente, o runner toca o arquivo
  // direto; quando null, cai no TTS em runtime de `text`.
  audioUrl?: string;
};

function buildSteps(part: Part, itemIndex: number, prompt: PilotPrompt): Step[] {
  const steps: Step[] = [];
  if (itemIndex === 0) {
    steps.push({ stage: "intro", kind: "auto", durationSeconds: 3, text: PART_INTRO_TEXT[part] });
  }

  if (part === "part1") {
    steps.push({ stage: "main", kind: "response", text: prompt.promptText });
    return steps;
  }

  if (part === "part2") {
    // Setup da situação (prompt_text) — o examinador fala isto antes de tocar
    // a primeira chamada do controlador ("You are at Guarulhos Airport, ready
    // to taxi... Listen to Ground Control and read back."). Sem este passo, o
    // candidato ouvia a chamada do ATC sem nenhum contexto de onde está / o
    // que está fazendo.
    steps.push({ stage: "intro", kind: "auto", durationSeconds: 3, text: prompt.promptText });
    steps.push({
      stage: "readback",
      kind: "response",
      text: prompt.atcAudioText ?? "",
      audioUrl: prompt.atcAudioUrl ?? undefined,
    });
    steps.push({ stage: "reaction", kind: "response", text: prompt.complicationText ?? "" });
    steps.push({
      stage: "confirmation",
      kind: "response",
      text: prompt.atcFollowupAudioText ?? "",
      audioUrl: prompt.atcFollowupAudioUrl ?? undefined,
    });
    steps.push({
      stage: "report_back",
      kind: "response",
      text: "Now, tell me everything the controller said in that last recording.",
    });
    return steps;
  }

  if (part === "part3") {
    // Narra o diálogo piloto/controlador (o candidato só escuta, não interage
    // como piloto aqui) e avança sozinho pro turno de relato, igual ao step
    // "auto" de introdução de parte.
    steps.push({
      stage: "report",
      kind: "auto",
      durationSeconds: 3,
      text: prompt.promptText,
      audioUrl: prompt.dialogueAudioUrl ?? undefined,
    });
    steps.push({
      stage: "report",
      kind: "response",
      text: "Now tell me, in your own words, everything the pilot and the controller said.",
    });
    steps.push({ stage: "question", kind: "response", text: prompt.discussionQuestion ?? "" });
    if (itemIndex === PART_SIZES.part3 - 1) {
      steps.push({
        stage: "comparison",
        kind: "response",
        text:
          "Now, considering the three situations you heard, how would you compare them? Which one do you think is the most difficult to deal with, and why?",
      });
    }
    return steps;
  }

  // part4 — segue os 6 itens do "Modelo SDEA com anotações": descrição, hipótese
  // de antes (item 2, com 4 variações — só uma por prova), hipótese de depois
  // (item 3), duas perguntas de discussão fixas (itens 4 e 5) e a afirmação pra
  // concordar/discordar (item 6). Só a afirmação é específica da foto (vem do
  // banco); todo o resto é fixo.
  steps.push({ stage: "picture_description", kind: "response", text: prompt.promptText });
  steps.push({
    stage: "narrative",
    kind: "response",
    text: PART4_BEFORE_VARIATIONS[hashStringToSeed(prompt.id) % PART4_BEFORE_VARIATIONS.length],
  });
  steps.push({
    stage: "narrative",
    kind: "response",
    text: "Now imagine that this picture has just been taken. What do you think will happen next?",
  });
  steps.push({ stage: "discussion_1", kind: "response", text: PART4_DISCUSSION_1 });
  steps.push({ stage: "discussion_2", kind: "response", text: PART4_DISCUSSION_2 });
  steps.push({
    stage: "agree_disagree",
    kind: "response",
    text: prompt.agreeDisagreeStatement
      ? `Now I am going to read a statement to you, and you will tell me to what extent you agree or disagree with it, justifying your opinion with arguments and examples. "${prompt.agreeDisagreeStatement}"`
      : "",
  });
  return steps;
}

// Item 2 da Parte 4: 4 variações da pergunta de "antes", conforme o Modelo SDEA
// — nunca aparecem juntas, uma é sorteada por prova (determinística pelo id da
// foto, que já é sorteada por tentativa).
const PART4_BEFORE_VARIATIONS = [
  "What do you think happened before this picture was taken?",
  "What do you think the people in this picture were doing before it was taken?",
  "What do you think was happening just before this picture was taken?",
  "Can you create a short story based on this picture? Use your imagination.",
];

// Itens 4 e 5 da Parte 4: perguntas de discussão fixas, aplicáveis a qualquer
// foto (avaliar severidade, inferir consequências, comparar e prevenir).
const PART4_DISCUSSION_1 =
  "How serious do you think a situation like the one in this picture can be, and what makes it more or less dangerous?";
const PART4_DISCUSSION_2 =
  "What consequences can a situation like this have for other flights, for the airport, or for aviation in general, and how could it be prevented?";

function pickPrompt(sequence: PilotSequence, part: Part, itemIndex: number): PilotPrompt {
  return sequence[part][itemIndex];
}

function stepAt(sequence: PilotSequence, part: Part, itemIndex: number, stepIndex: number): Step {
  const prompt = pickPrompt(sequence, part, itemIndex);
  return buildSteps(part, itemIndex, prompt)[stepIndex];
}

// Mesmo padrão do controlador: remonta via `key` a cada estágio, decrementa
// dentro de um setTimeout (não sincronamente no corpo do effect).
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
    <div className="iv-countdown">
      <span className="iv-k">Gravação automática</span>
      <span>{formatElapsed(remaining)}</span>
    </div>
  );
}

type RecorderState = "waiting_ai" | "ready" | "recording" | "paused" | "submitting" | "feedback";

function stepKey(part: Part, itemIndex: number, stepIndex: number): string {
  return `${part}-${itemIndex}-${stepIndex}`;
}

function isAutoplayBlocked(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}

export function PilotInterviewRunner({
  attemptId,
  mode,
  sequence,
  initialPart,
  initialItemIndex,
}: {
  attemptId: string;
  mode: SimulationMode;
  sequence: PilotSequence;
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
  const [recorderState, setRecorderState] = useState<RecorderState>("waiting_ai");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [awaitingFeedbackSpeech, setAwaitingFeedbackSpeech] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const advancingItemRef = useRef(false);
  const micAnalyserRef = useRef<{ analyser: AnalyserNode; close: () => void } | null>(null);

  const teardownMic = useCallback(() => {
    micAnalyserRef.current?.close();
    micAnalyserRef.current = null;
    setMicAnalyser(null);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => teardownMic, [teardownMic]);

  const currentPrompt = pickPrompt(sequence, part, itemIndex);
  const steps = buildSteps(part, itemIndex, currentPrompt);
  const currentStep = steps[stepIndex];

  // Mesma trava usada no InterviewRunner do controlador (advancingItemRef):
  // sem ela, o timer automático do step "auto" e um clique quase simultâneo
  // podem chamar advanceState duas vezes, e a segunda encontra a tentativa já
  // avançada/concluída pela primeira.
  const goToNextItem = useCallback(() => {
    if (advancingItemRef.current) return;
    advancingItemRef.current = true;
    startTransition(async () => {
      try {
        const result = await advanceState(attemptId);
        if (result.finished) {
          router.push(`/sdea/resultado/${attemptId}`);
          return;
        }
        const next = computeNextPosition(part, itemIndex);
        if (!next) return;
        setPart(next.part);
        setItemIndex(next.itemIndex);
        setStepIndex(0);
        setRepetitionCount(0);
        setRecorderState("waiting_ai");
        setFeedback(null);
        setAwaitingFeedbackSpeech(false);
        chunksRef.current = [];
      } finally {
        advancingItemRef.current = false;
      }
    });
  }, [attemptId, part, itemIndex, router, startTransition]);

  const goToNextStepRef = useRef<() => void>(() => {});
  const goToNextStep = useCallback(() => {
    if (stepIndex + 1 < steps.length) {
      setStepIndex((i) => i + 1);
      setRecorderState("waiting_ai");
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

  useEffect(() => {
    const audioMaybe = audioRef.current;
    if (!audioMaybe) return;
    const audio = audioMaybe;

    const step = stepAt(sequence, part, itemIndex, stepIndex);
    // Gravação da Parte 3 (áudio pré-gerado, step "auto"): o exame real toca
    // cada situação duas vezes (doc "Modelo SDEA com anotações", pág. 5).
    const playTwice = Boolean(step.audioUrl) && step.kind === "auto";
    let finished = false;
    let playsDone = 0;
    let advanceTimeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    function finish() {
      if (finished) return;
      finished = true;
      if (step.kind === "response") {
        setRecorderState("ready");
      } else {
        advanceTimeout = setTimeout(() => goToNextStepRef.current(), 3000);
      }
    }

    function onEnded() {
      playsDone += 1;
      if (playTwice && playsDone < 2 && !cancelled) {
        advanceTimeout = setTimeout(() => {
          if (cancelled) return;
          audio.currentTime = 0;
          audio.play().catch(() => finish());
        }, 1500);
        return;
      }
      finish();
    }

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", finish);

    function playSrc(src: string) {
      if (cancelled) return;
      audio.src = src;
      audio.play().catch((err) => {
        if (cancelled) return;
        if (isAutoplayBlocked(err)) setAudioBlocked(true);
        finish();
      });
    }

    if (step.audioUrl) {
      playSrc(step.audioUrl);
    } else {
      generateSpeech(attemptId, step.text)
        .then(({ audioBase64, mimeType }) => playSrc(`data:${mimeType};base64,${audioBase64}`))
        .catch(() => {
          if (!cancelled) finish();
        });
    }

    return () => {
      cancelled = true;
      if (advanceTimeout) clearTimeout(advanceTimeout);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", finish);
    };
  }, [part, itemIndex, stepIndex, sequence, attemptId]);

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
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError(
        "Este navegador não permite acesso ao microfone nesta conexão (precisa ser HTTPS, exceto em localhost).",
      );
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicError(
        "Não foi possível acessar o microfone. Verifique se a permissão foi concedida ao navegador.",
      );
      return;
    }
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    teardownMic();
    const mic = createMicAnalyser(stream);
    micAnalyserRef.current = mic;
    setMicAnalyser(mic?.analyser ?? null);
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
    teardownMic();
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

  async function pauseAttempt() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stream.getTracks().forEach((t) => t.stop());
    }
    teardownMic();
    if (recorderState === "feedback" && stepIndex + 1 >= steps.length) {
      const result = await advanceState(attemptId);
      if (result.finished) {
        router.push(`/sdea/resultado/${attemptId}`);
        return;
      }
    }
    router.push("/sdea");
  }

  function finishAndSubmit() {
    setRecorderState("submitting");
    teardownMic();
    stopRecorderAndGetBlob().then((blob) => {
      startTransition(async () => {
        const formData = new FormData();
        formData.append("attemptId", attemptId);
        formData.append("promptId", currentPrompt.id);
        formData.append("stage", currentStep.stage as PilotResponseStage);
        formData.append("repetitionCount", String(repetitionCount));
        formData.append("audio", blob, `audio.${blob.type.includes("mp4") ? "mp4" : "webm"}`);

        const res = await fetch("/api/sdea/submit-response", { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Não foi possível enviar a resposta.");
        }
        const result = (await res.json()) as { transcript: string; feedback: string | null };

        if (mode === "official") {
          goToNextStep();
          return;
        }

        setFeedback(result.feedback);
        setRecorderState("feedback");

        if (result.feedback) {
          setAwaitingFeedbackSpeech(true);
          try {
            const speech = await generateSpeech(attemptId, result.feedback);
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

  const showPart4Image = part === "part4" && currentPrompt.imageUrl;
  const showPart2ComplicationImage =
    part === "part2" && currentStep.stage === "reaction" && currentPrompt.complicationImageUrl;

  const isRecording = recorderState === "recording" || recorderState === "paused";
  const orbState: OrbState = isRecording
    ? "rec"
    : speaking || recorderState === "waiting_ai" || awaitingFeedbackSpeech
      ? "speak"
      : "idle";

  const status: { tone: OrbState; title: string; sub?: string } = (() => {
    if (recorderState === "recording")
      return { tone: "rec", title: "Sua vez — gravando", sub: "Fale sua resposta e conclua quando terminar." };
    if (recorderState === "paused")
      return { tone: "rec", title: "Gravação pausada", sub: "Retome quando estiver pronto." };
    if (recorderState === "submitting")
      return { tone: "idle", title: "Processando", sub: "Transcrevendo e avaliando sua resposta…" };
    if (recorderState === "feedback")
      return awaitingFeedbackSpeech
        ? { tone: "speak", title: "Examinador falando", sub: "Ouça o comentário do examinador." }
        : { tone: "idle", title: "Feedback", sub: "Leia o comentário e siga em frente." };
    if (speaking || recorderState === "waiting_ai")
      return { tone: "speak", title: "Examinador falando", sub: "Ouça com atenção." };
    if (recorderState === "ready")
      return {
        tone: "idle",
        title: "Sua vez",
        sub:
          mode === "official"
            ? "A gravação começa automaticamente."
            : "Toque no microfone para responder.",
      };
    return { tone: "idle", title: "Aguarde", sub: undefined };
  })();

  function renderDeck() {
    if (currentStep.kind !== "response") {
      return (
        <>
          <DeckNote>Aguarde a IA terminar de falar…</DeckNote>
          <DeckSpacer />
        </>
      );
    }

    if (recorderState === "ready" && mode === "practice") {
      return (
        <>
          <KeyButton icon="mic" label="Falar" variant="primary" onClick={startRecording} />
          <KeyButton icon="replay" label="Repetir pergunta" onClick={replayAudio} />
          <DeckSpacer />
        </>
      );
    }

    if (recorderState === "ready" && mode === "official") {
      return (
        <>
          <KeyButton icon="replay" label="Repetir pergunta" onClick={replayAudio} />
          <DeckSpacer />
        </>
      );
    }

    if (isRecording) {
      return (
        <>
          {recorderState === "recording" ? (
            <KeyButton icon="pause" label="Pausar" variant="accent" onClick={pauseRecording} />
          ) : (
            <KeyButton
              icon="play"
              label="Continuar falando"
              variant="accent"
              onClick={resumeRecording}
            />
          )}
          {mode === "practice" && (
            <KeyButton icon="restart" label="Recomeçar" onClick={restartRecording} />
          )}
          <KeyButton
            icon="check"
            label="Concluir e enviar"
            variant="primary"
            onClick={finishAndSubmit}
          />
          <DeckSpacer />
        </>
      );
    }

    if (recorderState === "submitting") {
      return (
        <>
          <DeckNote>Transcrevendo e avaliando sua resposta…</DeckNote>
          <DeckSpacer />
        </>
      );
    }

    if (recorderState === "feedback") {
      return (
        <>
          {awaitingFeedbackSpeech ? (
            <DeckNote>Aguarde a IA terminar de falar o feedback…</DeckNote>
          ) : (
            <KeyButton icon="play" label="Continuar" variant="primary" onClick={goToNextStep} />
          )}
          <DeckSpacer />
        </>
      );
    }

    return (
      <>
        <DeckNote>Aguarde a IA terminar de falar…</DeckNote>
        <DeckSpacer />
      </>
    );
  }

  const contextImage = showPart4Image
    ? { src: currentPrompt.imageUrl!, alt: "Imagem para descrição e discussão" }
    : showPart2ComplicationImage
      ? { src: currentPrompt.complicationImageUrl!, alt: "Situação apresentada por imagem" }
      : null;

  return (
    <div className="space-y-4">
      <audio ref={audioRef} />

      {micError && <div className="note note-danger">{micError}</div>}

      {audioBlocked && (
        <div className="note note-caution flex items-center justify-between gap-3">
          <span>
            O navegador bloqueou o áudio automático da IA (comum ao abrir o simulado direto por um
            link, sem nenhum clique antes). Clique para ativar.
          </span>
          <button
            type="button"
            onClick={unlockAudio}
            className="btn btn-secondary shrink-0 !px-3 !py-1.5 !text-xs"
          >
            🔊 Ativar áudio
          </button>
        </div>
      )}

      {mode === "practice" && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={pauseAttempt}
            className="btn btn-secondary !px-3 !py-1.5 !text-xs"
          >
            Pausar simulado
          </button>
        </div>
      )}

      {contextImage && (
        <div className="card p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={contextImage.src}
            alt={contextImage.alt}
            className="max-h-96 w-full rounded-md object-contain"
          />
        </div>
      )}

      <div className="iv">
        <InterviewStrip
          mode={mode}
          part={part}
          itemIndex={itemIndex}
          elapsedLabel={formatElapsed(elapsed)}
        />

        <div className="iv-stage">
          <RecLight active={isRecording} />
          <div className="iv-orb-wrap">
            <AudioOrb state={orbState} analyser={micAnalyser} />
          </div>
          <StatusLine tone={status.tone} title={status.title} sub={status.sub} />

          {currentStep.kind === "response" &&
            recorderState === "ready" &&
            mode === "official" &&
            !speaking && (
              <ResponseStartTimer
                key={stepKey(part, itemIndex, stepIndex)}
                seconds={5}
                onExpire={startRecording}
              />
            )}

          {repetitionCount >= 1 && recorderState === "ready" && (
            <p className="iv-sub text-caution">
              Pedir a pergunta de novo pesa no critério Compreensão — o relatório final sinaliza
              isso.
            </p>
          )}
        </div>

        <KeyDeck>{renderDeck()}</KeyDeck>

        {recorderState === "feedback" && feedback && (
          <div className="iv-cc">
            <span className="iv-who">Feedback</span>
            {feedback}
          </div>
        )}
      </div>
    </div>
  );
}
