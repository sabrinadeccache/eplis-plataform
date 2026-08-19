"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordAnswer, finishAttempt } from "@/services/simulations/phase1/actions";
import type { Phase1QuizItem } from "@/services/simulations/phase1/queries";
import type { McqOption } from "@/types/database";

// Timers conforme docs/database-schema.md (item "phase1_answers" — Manual do
// Examinando 1.2.1): 30s de leitura (áudio pode ser iniciado antes) → áudio real
// (até 45s) → 1min para responder, com a reescuta opcional dentro da mesma janela.
const READING_SECONDS = 30;
const ANSWER_SECONDS = 60;

type RunnerPhase = "reading" | "playing" | "answering";

// Componente-relógio: remonta a cada troca de fase/questão (via `key` no
// componente pai), então a contagem regressiva sempre nasce fresca do valor de
// `seconds` no render inicial — sem precisar de um efeito "resetando" outro
// estado, que é exatamente o padrão que o react-hooks/set-state-in-effect existe
// para evitar.
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.75-6.86a1 1 0 0 0 0-1.7L9.53 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function SoundBarsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="4" y="9" width="3" height="6" className="animate-[pulse_0.9s_ease-in-out_infinite]" />
      <rect
        x="10.5"
        y="5"
        width="3"
        height="14"
        className="animate-[pulse_0.9s_ease-in-out_infinite_0.15s]"
      />
      <rect
        x="17"
        y="9"
        width="3"
        height="6"
        className="animate-[pulse_0.9s_ease-in-out_infinite_0.3s]"
      />
    </svg>
  );
}

// Player circular reaproveitado nas três fases: em "reading" inicia o áudio na
// hora (pulando o resto da leitura), em "playing" só mostra que está tocando
// (sem pausa — o áudio da prova roda até o fim), em "answering" reproduz de
// novo (reescuta opcional dentro da janela de resposta).
function AudioPlayerButton({
  phase,
  onPlay,
}: {
  phase: RunnerPhase;
  onPlay: () => void;
}) {
  const isPlaying = phase === "playing";
  const label =
    phase === "reading" ? "Ouvir áudio" : phase === "playing" ? "Reproduzindo…" : "Repetir áudio";

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onPlay}
        disabled={isPlaying}
        aria-label={label}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-80 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {isPlaying ? (
          <SoundBarsIcon className="h-6 w-6" />
        ) : (
          <PlayIcon className="h-6 w-6 translate-x-0.5" />
        )}
      </button>
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function Countdown({
  seconds,
  onTick,
  onExpire,
}: {
  seconds: number;
  onTick: (remaining: number) => void;
  onExpire: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    onTick(remaining);
    if (remaining <= 0) {
      onExpire();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, onTick, onExpire]);

  return null;
}

export function Phase1Runner({
  attemptId,
  questions,
}: {
  attemptId: string;
  questions: Phase1QuizItem[];
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<RunnerPhase>("reading");
  const [secondsLeft, setSecondsLeft] = useState(READING_SECONDS);
  const [selected, setSelected] = useState<McqOption | null>(null);
  const [, startTransition] = useTransition();
  const audioRef = useRef<HTMLAudioElement>(null);
  const advancingRef = useRef(false);

  const current = questions[index];
  const isLast = index === questions.length - 1;

  useEffect(() => {
    if (phase === "playing") audioRef.current?.play().catch(() => {});
  }, [phase, index]);

  // O timer de resposta (onExpire) e o botão "Confirmar e avançar" podem
  // disparar `advance` quase simultaneamente quando o clique acontece bem no
  // fim da contagem — sem essa trava, as duas execuções concorrentes chegam a
  // rodar `setIndex(i => i + 1)` (pulando uma questão) ou `finishAttempt` (a
  // segunda vê a tentativa já concluída e lança erro) duas vezes.
  const advance = useCallback(() => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    startTransition(async () => {
      try {
        if (selected) {
          await recordAnswer(attemptId, current.id, selected);
        }
        if (isLast) {
          await finishAttempt(attemptId);
          router.push(`/fase1/resultado/${attemptId}`);
        } else {
          setSelected(null);
          setPhase("reading");
          setIndex((i) => i + 1);
        }
      } finally {
        advancingRef.current = false;
      }
    });
  }, [attemptId, current, isLast, router, selected]);

  return (
    <div className="space-y-6">
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        Questão {index + 1} de {questions.length}
      </p>

      <AudioPlayerButton
        phase={phase}
        onPlay={() => {
          if (phase === "reading") setPhase("playing");
          else if (phase === "answering") audioRef.current?.play().catch(() => {});
        }}
      />

      {phase === "reading" && (
        <Countdown
          key={`reading-${index}`}
          seconds={READING_SECONDS}
          onTick={setSecondsLeft}
          onExpire={() => setPhase("playing")}
        />
      )}
      {phase === "answering" && (
        <Countdown
          key={`answering-${index}`}
          seconds={ANSWER_SECONDS}
          onTick={setSecondsLeft}
          onExpire={advance}
        />
      )}

      <audio ref={audioRef} src={current.audioUrl} onEnded={() => setPhase("answering")} />

      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">{current.prompt}</p>

        <div className="mt-4 space-y-2">
          {([
            ["a", current.optionA],
            ["b", current.optionB],
            ["c", current.optionC],
          ] as const).map(([value, label]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                selected === value
                  ? "border-zinc-900 dark:border-zinc-100"
                  : "border-zinc-200 dark:border-zinc-800"
              } ${phase !== "answering" ? "opacity-50" : ""}`}
            >
              <input
                type="radio"
                name="option"
                value={value}
                disabled={phase !== "answering"}
                checked={selected === value}
                onChange={() => setSelected(value)}
              />
              {label}
            </label>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          {phase === "reading" && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Leitura da pergunta — {secondsLeft}s
            </p>
          )}

          {phase === "playing" && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Reproduzindo áudio…</p>
          )}

          {phase === "answering" && (
            <>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Tempo para responder — {secondsLeft}s
              </p>
              <button
                type="button"
                onClick={advance}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                {isLast ? "Finalizar simulado" : "Confirmar e avançar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
