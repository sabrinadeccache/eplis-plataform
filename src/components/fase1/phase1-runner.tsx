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

  const current = questions[index];
  const isLast = index === questions.length - 1;

  useEffect(() => {
    if (phase === "playing") audioRef.current?.play().catch(() => {});
  }, [phase, index]);

  const advance = useCallback(() => {
    startTransition(async () => {
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
    });
  }, [attemptId, current, isLast, router, selected]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Questão {index + 1} de {questions.length}
      </p>

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
            <>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Leitura da pergunta — {secondsLeft}s
              </p>
              <button
                type="button"
                onClick={() => setPhase("playing")}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Ouvir áudio agora
              </button>
            </>
          )}

          {phase === "playing" && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Reproduzindo áudio…</p>
          )}

          {phase === "answering" && (
            <>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Tempo para responder — {secondsLeft}s
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => audioRef.current?.play().catch(() => {})}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Repetir áudio
                </button>
                <button
                  type="button"
                  onClick={advance}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {isLast ? "Finalizar simulado" : "Confirmar e avançar"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
