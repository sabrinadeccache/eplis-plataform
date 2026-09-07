"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateSpeech, advanceState } from "@/services/simulations/phase2/actions";
import { computeNextPosition } from "@/services/simulations/phase2/state-machine";
import type { Phase2Sequence, Phase2Prompt } from "@/services/simulations/phase2/queries";
import type { Part, ResponseStage, SimulationMode } from "@/types/database";
import { AudioOrb, type OrbState } from "@/components/interview/audio-orb";
import {
  InterviewStrip,
  RecLight,
  StatusLine,
  KeyDeck,
  KeyButton,
  DeckSpacer,
  DeckNote,
  CaptionsToggle,
  CaptionsPanel,
  formatElapsed,
  createMicAnalyser,
} from "@/components/interview/interview-ui";

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

  return (
    <div className="iv-countdown">
      <span className="iv-k">Preparação</span>
      <span>{formatElapsed(remaining)}</span>
    </div>
  );
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
  const [micError, setMicError] = useState<string | null>(null);
  const [captionsOn, setCaptionsOn] = useState(false);
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

  // Cronômetro da faixa de progresso — decorrido desde que a tela abriu.
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => teardownMic, [teardownMic]);

  const currentPrompt = pickPrompt(sequence, part, itemIndex);
  const steps = buildSteps(part, itemIndex, currentPrompt);
  const currentStep = steps[stepIndex];

  // Mesma trava usada no Phase1Runner (advancingRef): o timer automático de
  // 3s do step "auto" e o clique manual em "Continuar" podem disparar
  // goToNextItem quase ao mesmo tempo no último step de um item — sem essa
  // trava, a segunda chamada de advanceState() encontra a tentativa já
  // avançada/concluída pela primeira e lança "Tentativa inválida ou já
  // finalizada." como unhandled rejection (reproduzido de verdade, capturado
  // pelo Sentry como EPLIS-PLATAFORM-4).
  const goToNextItem = useCallback(() => {
    if (advancingItemRef.current) return;
    advancingItemRef.current = true;
    startTransition(async () => {
      try {
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
    generateSpeech(attemptId, step.text)
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
  }, [part, itemIndex, stepIndex, sequence, attemptId]);

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
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // getUserMedia só existe em contexto seguro (HTTPS, ou localhost) — em
      // HTTP puro por IP de rede (ex.: testando pelo celular) o navegador nem
      // expõe a API, sem pedir permissão nenhuma.
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
    // Alimenta o visualizador com o nível real da voz do candidato.
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

  // Pausar o simulado inteiro (só no modo practice — o official é fiel ao
  // exame real e não admite pausa). A posição (parte/item) só é persistida no
  // banco quando `advanceState` roda (ao clicar "Continuar" na tela de
  // feedback do último estágio de um item) — se o candidato pausa bem ali,
  // antes de clicar "Continuar", a resposta já tinha sido gravada mas a
  // posição ficava presa no mesmo item ao retomar (achado real, reportado
  // pela Sabrina). Corrigido chamando `advanceState` aqui também nesse caso
  // específico, antes de sair. Sub-estágios intermediários dentro de um item
  // (ex.: Parte 2 antes da 2ª etapa) continuam não persistidos — mesmo
  // comportamento de um reload no meio do item, já documentado.
  async function pauseAttempt() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stream.getTracks().forEach((t) => t.stop());
    }
    teardownMic();
    if (recorderState === "feedback" && stepIndex + 1 >= steps.length) {
      const result = await advanceState(attemptId);
      if (result.finished) {
        router.push(`/fase2/resultado/${attemptId}`);
        return;
      }
    }
    router.push("/fase2");
  }

  function finishAndSubmit() {
    setRecorderState("submitting");
    teardownMic();
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
    if (currentStep.kind === "silent" && ttsEnded)
      return { tone: "idle", title: "Preparando", sub: currentStep.text };
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
    if (currentStep.kind === "silent") {
      return (
        <>
          <DeckNote>
            <b>Estágio cronometrado.</b> A tela avança sozinha ao fim do tempo.
          </DeckNote>
          <DeckSpacer />
          <CaptionsToggle on={captionsOn} onToggle={() => setCaptionsOn((v) => !v)} />
        </>
      );
    }

    if (recorderState === "ready" && mode === "practice") {
      return (
        <>
          <KeyButton icon="mic" label="Falar" variant="primary" onClick={startRecording} />
          <KeyButton icon="replay" label="Repetir pergunta" onClick={replayAudio} />
          <DeckSpacer />
          <CaptionsToggle on={captionsOn} onToggle={() => setCaptionsOn((v) => !v)} />
        </>
      );
    }

    if (recorderState === "ready" && mode === "official") {
      return (
        <>
          <KeyButton icon="replay" label="Repetir pergunta" onClick={replayAudio} />
          <DeckSpacer />
          <CaptionsToggle on={captionsOn} onToggle={() => setCaptionsOn((v) => !v)} />
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
          <CaptionsToggle on={captionsOn} onToggle={() => setCaptionsOn((v) => !v)} />
        </>
      );
    }

    if (recorderState === "submitting") {
      return (
        <>
          <DeckNote>Transcrevendo e avaliando sua resposta…</DeckNote>
          <DeckSpacer />
          <CaptionsToggle on={captionsOn} onToggle={() => setCaptionsOn((v) => !v)} />
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
          <CaptionsToggle on={captionsOn} onToggle={() => setCaptionsOn((v) => !v)} />
        </>
      );
    }

    // waiting_ai
    return (
      <>
        <DeckNote>Aguarde a IA terminar de falar…</DeckNote>
        <DeckSpacer />
        <CaptionsToggle on={captionsOn} onToggle={() => setCaptionsOn((v) => !v)} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <audio ref={audioRef} />

      {micError && <div className="note note-danger">{micError}</div>}

      {audioBlocked && (
        <div className="note note-caution flex items-center justify-between gap-3">
          <span>
            O navegador bloqueou o áudio automático da IA (comum ao abrir a entrevista direto por
            um link, sem nenhum clique antes). Clique para ativar.
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
        <div className="flex justify-end">
          <button
            type="button"
            onClick={pauseAttempt}
            className="btn btn-secondary shrink-0 !px-3 !py-1.5 !text-xs"
          >
            Pausar simulado
          </button>
        </div>
      )}

      {part === "part4" && currentPrompt.imageUrl && (
        // Conteúdo do exame (não decoração): visível durante todo o item da
        // Parte 4 — o candidato precisa olhar pra imagem de novo ao contar a
        // história, não só na observação inicial.
        <div className="card p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentPrompt.imageUrl}
            alt="Imagem para descrição e história"
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

          {currentStep.kind === "silent" && ttsEnded && (
            <SilentTimer
              key={stepKey(part, itemIndex, stepIndex)}
              seconds={currentStep.durationSeconds ?? 15}
              onExpire={goToNextStep}
            />
          )}

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

        {captionsOn && currentStep.kind !== "silent" && (
          <CaptionsPanel text={currentStep.text} />
        )}

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
