"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  recordAnswer,
  finishAttempt,
  type RecordAnswerResult,
} from "@/services/simulations/phase1/actions";
import type { Phase1QuizItem } from "@/services/simulations/phase1/queries";
import type { McqOption } from "@/types/database";

const OPTION_ORDER: McqOption[] = ["a", "b", "c"];

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
      <rect x="10.5" y="5" width="3" height="14" className="animate-[pulse_0.9s_ease-in-out_infinite_0.15s]" />
      <rect x="17" y="9" width="3" height="6" className="animate-[pulse_0.9s_ease-in-out_infinite_0.3s]" />
    </svg>
  );
}

export function Phase1PracticeRunner({
  attemptId,
  questions,
}: {
  attemptId: string;
  questions: Phase1QuizItem[];
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<McqOption | null>(null);
  const [reveal, setReveal] = useState<RecordAnswerResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [, startTransition] = useTransition();
  const audioRef = useRef<HTMLAudioElement>(null);
  const busyRef = useRef(false);

  const current = questions[index];
  const isLast = index === questions.length - 1;
  const options = [current.optionA, current.optionB, current.optionC];

  function playAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  function submitAnswer() {
    if (busyRef.current || !selected || reveal) return;
    busyRef.current = true;
    startTransition(async () => {
      try {
        const result = await recordAnswer(attemptId, current.id, selected);
        setReveal(result);
      } finally {
        busyRef.current = false;
      }
    });
  }

  const advance = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    startTransition(async () => {
      try {
        if (isLast) {
          await finishAttempt(attemptId);
          router.push(`/fase1/resultado/${attemptId}`);
        } else {
          setIndex((i) => i + 1);
          setSelected(null);
          setReveal(null);
          setPlaying(false);
          setHasPlayed(false);
        }
      } finally {
        busyRef.current = false;
      }
    });
  }, [attemptId, isLast, router]);

  return (
    <div className="space-y-6">
      <div>
        <div className="section-head">
          <h1 className="text-sm font-medium text-ink">Fase 1 — practice</h1>
          <span className="data text-sm text-muted">{`${index + 1}/${questions.length}`}</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={playAudio}
          aria-label={playing ? "Reproduzindo" : "Ouvir áudio"}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white transition hover:bg-brand-strong"
        >
          {playing ? (
            <SoundBarsIcon className="h-6 w-6" />
          ) : (
            <PlayIcon className="h-6 w-6 translate-x-0.5" />
          )}
        </button>
        <p className="text-xs font-medium text-muted">
          {playing ? "Reproduzindo…" : reveal ? "Ouvir de novo" : "Ouvir áudio"}
        </p>
      </div>

      <audio
        key={current.id}
        ref={audioRef}
        src={current.audioUrl}
        onPlay={() => {
          setPlaying(true);
          setHasPlayed(true);
        }}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
      />

      <div className="card p-6">
        <p className="text-lg font-medium text-ink">{current.prompt}</p>

        <div className="mt-4 space-y-2">
          {OPTION_ORDER.map((value, i) => {
            const isCorrectOption = reveal?.correctOption === value;
            const isWrongPick = Boolean(reveal) && selected === value && !isCorrectOption;
            const cls = isCorrectOption
              ? "border-success bg-success/10 text-ink"
              : isWrongPick
                ? "border-danger bg-danger/10 text-ink"
                : selected === value
                  ? "border-brand bg-brand/5 text-ink"
                  : "border-line text-ink";
            return (
              <label
                key={value}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${cls} ${
                  reveal ? "" : "cursor-pointer"
                }`}
              >
                <input
                  type="radio"
                  name="option"
                  value={value}
                  disabled={Boolean(reveal)}
                  checked={selected === value}
                  onChange={() => setSelected(value)}
                />
                {options[i]}
              </label>
            );
          })}
        </div>

        {!reveal ? (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submitAnswer}
              disabled={!selected || !hasPlayed}
              className="btn btn-primary"
            >
              Responder
            </button>
            {!hasPlayed && (
              <p className="text-xs text-muted">Ouça o áudio antes de responder.</p>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <p
              className={`text-sm font-medium ${
                reveal.isCorrect ? "text-success" : "text-danger"
              }`}
            >
              {reveal.isCorrect ? "Você acertou." : "Não foi dessa vez."}
            </p>

            {reveal.transcript && (
              <div className="note">
                <p className="text-xs font-medium text-muted">Transcrição do áudio</p>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed text-ink">
                  {reveal.transcript}
                </p>
                <button
                  type="button"
                  onClick={playAudio}
                  className="btn btn-secondary mt-3 !px-3 !py-1.5 !text-xs"
                >
                  Ouvir de novo
                </button>
              </div>
            )}

            <button type="button" onClick={advance} className="btn btn-primary">
              {isLast ? "Ver resultado" : "Próxima questão"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
