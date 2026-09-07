"use client";

import type { ReactNode } from "react";
import type { Part, SimulationMode } from "@/types/database";

// Peças visuais compartilhadas pela IHM da entrevista (Fase 2 e SDEA). A lógica
// de gravação/TTS/timers continua em cada runner; aqui é só apresentação.

const ICONS = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
  play: '<path d="M8 5v14l11-7Z"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M5 3v4h4"/>',
  check: '<path d="M4 12.5 10 18 20 6"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7-7-1Z"/>',
  replay: '<path d="M4 12a8 8 0 1 1 2.3 5.6"/><path d="M5 21v-4h4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  skip: '<path d="M5 5v14l9-7Z"/><path d="M17 5v14"/>',
} as const;

export type KeyIcon = keyof typeof ICONS;

export function KeyButton({
  icon,
  label,
  variant,
  onClick,
  disabled = false,
  dimmed = false,
  className,
}: {
  icon: KeyIcon;
  label: string;
  variant?: "accent" | "primary";
  onClick?: () => void;
  disabled?: boolean;
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <span className={`iv-keywrap${dimmed ? " off" : ""}`}>
      <button
        type="button"
        className={`iv-key${variant ? ` ${variant}` : ""}${className ? ` ${className}` : ""}`}
        aria-label={label}
        disabled={disabled || dimmed}
        onClick={onClick}
      >
        <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: ICONS[icon] }} />
      </button>
      <span className="iv-keylabel">{label}</span>
    </span>
  );
}

export function KeyDeck({ children }: { children: ReactNode }) {
  return <div className="iv-deck">{children}</div>;
}

export function DeckSpacer() {
  return <span className="iv-spacer" />;
}

export function DeckNote({ children }: { children: ReactNode }) {
  return (
    <span className="iv-note">
      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: ICONS.clock }} />
      {children}
    </span>
  );
}

const PART_ORDER: Part[] = ["part1", "part2", "part3", "part4"];

export function InterviewStrip({
  mode,
  part,
  itemIndex,
  elapsedLabel,
}: {
  mode: SimulationMode;
  part: Part;
  itemIndex: number;
  elapsedLabel: string;
}) {
  const currentIdx = PART_ORDER.indexOf(part);
  return (
    <div className="iv-strip">
      <div>
        <span className="iv-lbl">Sessão</span>
        <span className="iv-val">
          {mode === "official" ? "Exame oficial" : "Simulação · practice"}
        </span>
      </div>
      <div className="iv-segs">
        <div className="iv-segwrap">
          {PART_ORDER.map((p, i) => (
            <div
              key={p}
              className={`iv-seg${i < currentIdx ? " done" : i === currentIdx ? " now" : ""}`}
            />
          ))}
        </div>
        <span className="iv-pos">
          Parte {part.replace("part", "")} · item {itemIndex + 1}
        </span>
      </div>
      <div>
        <span className="iv-lbl">Decorrido</span>
        <span className="iv-val">{elapsedLabel}</span>
      </div>
    </div>
  );
}

export function RecLight({ active }: { active: boolean }) {
  return (
    <div className={`iv-reclight${active ? " on" : ""}`}>
      <span className="iv-dot" />
      <span>REC</span>
    </div>
  );
}

export function StatusLine({
  tone,
  title,
  sub,
}: {
  tone: "speak" | "rec" | "idle";
  title: string;
  sub?: string;
}) {
  return (
    <div className="iv-status">
      <div className={`iv-now${tone === "rec" ? " rec" : tone === "speak" ? " speak" : ""}`}>
        {title}
      </div>
      {sub && <div className="iv-sub">{sub}</div>}
    </div>
  );
}

export function CaptionsToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="iv-toggle"
      aria-pressed={on}
      aria-label="Legendas"
      onClick={onToggle}
    >
      <span className="iv-sw" />
      Legendas
    </button>
  );
}

export function CaptionsPanel({ text }: { text: string }) {
  return (
    <div className="iv-cc">
      <span className="iv-who">Examinador</span>
      {text}
    </div>
  );
}

// Formata segundos como mm:ss pro cronômetro da faixa.
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Liga um AnalyserNode ao stream do microfone pra alimentar o visualizador com
// o nível real da voz do candidato. Não conecta nada ao destino (sem retorno de
// áudio). Retorna null se a Web Audio API não existir (jsdom nos testes) ou
// falhar — o visualizador cai numa envoltória sintética nesse caso.
export function createMicAnalyser(
  stream: MediaStream,
): { analyser: AnalyserNode; close: () => void } | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    return {
      analyser,
      close: () => {
        try {
          source.disconnect();
        } catch {
          // já desconectado
        }
        ctx.close().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}
