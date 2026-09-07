"use client";

import { useEffect, useRef } from "react";

export type OrbState = "speak" | "rec" | "idle";

// Visualizador de áudio da entrevista — substitui o avatar. Uma esfera de vidro
// desenhada em canvas: pulsa com uma envoltória sintética quando a IA fala e,
// na vez do candidato, reage ao nível real do microfone (via `analyser`, um
// AnalyserNode ligado ao stream de gravação; quando ausente, cai numa
// envoltória sintética também). Sem dependência externa; respeita
// prefers-reduced-motion e degrada a um quadro estático se o canvas 2D não
// estiver disponível (jsdom nos testes).
export function AudioOrb({
  state,
  analyser = null,
  size = 240,
}: {
  state: OrbState;
  analyser?: AnalyserNode | null;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  const analyserRef = useRef<AnalyserNode | null>(analyser);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    analyserRef.current = analyser;
  }, [analyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion:reduce)").matches;

    const probe = document.createElement("canvas").getContext("2d");
    const freq = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);

    function readVar(name: string): string {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    function toRGB(input: string): [number, number, number] {
      if (!probe) return [90, 110, 140];
      probe.fillStyle = "#000";
      probe.fillStyle = input || "#5a6e8c";
      const v = probe.fillStyle;
      if (v.charAt(0) === "#") {
        if (v.length === 4) {
          return [
            parseInt(v[1] + v[1], 16),
            parseInt(v[2] + v[2], 16),
            parseInt(v[3] + v[3], 16),
          ];
        }
        return [
          parseInt(v.slice(1, 3), 16),
          parseInt(v.slice(3, 5), 16),
          parseInt(v.slice(5, 7), 16),
        ];
      }
      const m = v.match(/[\d.]+/g);
      return m ? [+m[0], +m[1], +m[2]] : [90, 110, 140];
    }
    const mix = (
      a: [number, number, number],
      b: [number, number, number],
      r: number,
    ): [number, number, number] => [
      Math.round(a[0] + (b[0] - a[0]) * r),
      Math.round(a[1] + (b[1] - a[1]) * r),
      Math.round(a[2] + (b[2] - a[2]) * r),
    ];
    const rgba = (c: [number, number, number], al: number) =>
      `rgba(${c[0]},${c[1]},${c[2]},${al})`;

    const WHITE: [number, number, number] = [255, 255, 255];
    const DARK: [number, number, number] = [6, 10, 16];

    let t = 0;
    let raf = 0;
    let micLevel = 0;

    function currentLevel(): number {
      const node = analyserRef.current;
      if (!node) return -1;
      try {
        node.getByteFrequencyData(freq as Uint8Array<ArrayBuffer>);
      } catch {
        return -1;
      }
      let sum = 0;
      for (let i = 0; i < freq.length; i++) sum += freq[i];
      const avg = freq.length ? sum / freq.length / 255 : 0;
      micLevel += (Math.min(1, avg * 2.2) - micLevel) * 0.25;
      return micLevel;
    }

    function frame() {
      t += 0.016;
      const mode = stateRef.current;
      const w = canvas!.width;
      const h = canvas!.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx!.clearRect(0, 0, w, h);

      const speak = mode === "speak";
      const rec = mode === "rec";
      const A = toRGB(rec ? readVar("--accent") : readVar("--brand"));
      const L = toRGB(readVar("--line"));

      const live = rec ? currentLevel() : -1;
      let env: number;
      if (mode === "idle") {
        env = 0.16 + 0.06 * Math.sin(t * 1.4);
      } else if (rec && live >= 0) {
        env = 0.2 + live * 0.85;
      } else if (rec) {
        env = 0.42 + 0.58 * Math.abs(Math.sin(t * 3.1) + 0.4 * Math.sin(t * 7.7));
      } else {
        env =
          0.3 +
          0.34 * (0.5 + 0.5 * Math.sin(t * 2.2)) +
          0.12 * Math.sin(t * 9.3);
      }
      env = Math.max(0, Math.min(1, env));

      const R = w * 0.48;

      // mostrador (ticks)
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const major = i % 6 === 0;
        const r2 = major ? R - w * 0.038 : R - w * 0.017;
        ctx!.beginPath();
        ctx!.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx!.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx!.strokeStyle = rgba(L, major ? 0.6 : 0.32);
        ctx!.lineWidth = major ? 2.2 : 1.3;
        ctx!.stroke();
      }
      [0.3, 0.47, 0.63].forEach((f) => {
        ctx!.beginPath();
        ctx!.arc(cx, cy, R * f, 0, 7);
        ctx!.strokeStyle = rgba(L, 0.34);
        ctx!.lineWidth = 1;
        ctx!.stroke();
      });

      // anéis de pulso com brilho
      ctx!.save();
      ctx!.shadowBlur = 26;
      ctx!.shadowColor = rgba(A, 0.8);
      for (let k = 0; k < 3; k++) {
        const rr =
          R * 0.5 +
          env * R * 0.34 +
          k * R * 0.1 +
          (reduce ? 0 : Math.sin(t * 1.6 + k) * 4);
        ctx!.beginPath();
        ctx!.arc(cx, cy, rr, 0, 7);
        ctx!.strokeStyle = rgba(A, 0.32 - k * 0.09);
        ctx!.lineWidth = 3;
        ctx!.stroke();
      }
      ctx!.restore();

      // esfera de vidro
      const SR = w * 0.19 + env * w * 0.055;
      ctx!.save();
      ctx!.shadowBlur = 34;
      ctx!.shadowColor = rgba(A, 0.45);
      const body = ctx!.createRadialGradient(
        cx - SR * 0.38,
        cy - SR * 0.42,
        SR * 0.12,
        cx,
        cy,
        SR,
      );
      body.addColorStop(0, rgba(mix(A, WHITE, 0.62), 1));
      body.addColorStop(0.46, rgba(A, 1));
      body.addColorStop(1, rgba(mix(A, DARK, 0.55), 1));
      ctx!.fillStyle = body;
      ctx!.beginPath();
      ctx!.arc(cx, cy, SR, 0, 7);
      ctx!.fill();
      ctx!.restore();

      const rim = ctx!.createLinearGradient(cx - SR, cy - SR, cx + SR, cy + SR);
      rim.addColorStop(0, rgba(mix(A, WHITE, 0.75), 0.95));
      rim.addColorStop(0.5, rgba(A, 0.12));
      rim.addColorStop(1, rgba(mix(A, WHITE, 0.45), 0.7));
      ctx!.strokeStyle = rim;
      ctx!.lineWidth = 2.2;
      ctx!.beginPath();
      ctx!.arc(cx, cy, SR - 1.3, 0, 7);
      ctx!.stroke();

      ctx!.strokeStyle = rgba(WHITE, 0.12);
      ctx!.lineWidth = 1.4;
      ctx!.beginPath();
      ctx!.ellipse(cx, cy, SR * 0.82, SR * 0.3, 0, 0, 7);
      ctx!.stroke();

      // reflexo especular
      ctx!.save();
      ctx!.beginPath();
      ctx!.arc(cx, cy, SR, 0, 7);
      ctx!.clip();
      const spec = ctx!.createRadialGradient(
        cx - SR * 0.34,
        cy - SR * 0.44,
        2,
        cx - SR * 0.34,
        cy - SR * 0.44,
        SR * 0.7,
      );
      spec.addColorStop(0, rgba(WHITE, 0.8));
      spec.addColorStop(1, rgba(WHITE, 0));
      ctx!.fillStyle = spec;
      ctx!.beginPath();
      ctx!.ellipse(cx - SR * 0.3, cy - SR * 0.4, SR * 0.52, SR * 0.34, -0.5, 0, 7);
      ctx!.fill();
      ctx!.restore();

      // varredura girando (IA falando)
      if (speak && !reduce) {
        ctx!.save();
        ctx!.translate(cx, cy);
        ctx!.rotate(t * 0.9);
        const sg = ctx!.createLinearGradient(0, 0, R * 0.78, 0);
        sg.addColorStop(0, rgba(A, 0.3));
        sg.addColorStop(1, rgba(A, 0));
        ctx!.fillStyle = sg;
        ctx!.beginPath();
        ctx!.moveTo(0, 0);
        ctx!.arc(0, 0, R * 0.78, -0.44, 0);
        ctx!.closePath();
        ctx!.fill();
        ctx!.restore();
      }

      // onda circular (gravando)
      if (rec) {
        ctx!.save();
        ctx!.shadowBlur = 12;
        ctx!.shadowColor = rgba(A, 0.9);
        ctx!.strokeStyle = rgba(A, 0.95);
        ctx!.lineWidth = 3.5;
        ctx!.lineCap = "round";
        const N = 56;
        for (let b = 0; b < N; b++) {
          const ba = (b / N) * Math.PI * 2 - Math.PI / 2;
          const seed = Math.abs(Math.sin(t * 4 + b * 0.55));
          const amp =
            w * 0.03 +
            (reduce
              ? w * 0.05
              : (seed * w * 0.11 + Math.sin(t * 9 + b) * w * 0.03) *
                (0.45 + env * 0.75));
          const r0 = SR + w * 0.05;
          ctx!.beginPath();
          ctx!.moveTo(cx + Math.cos(ba) * r0, cy + Math.sin(ba) * r0);
          ctx!.lineTo(cx + Math.cos(ba) * (r0 + amp), cy + Math.sin(ba) * (r0 + amp));
          ctx!.stroke();
        }
        ctx!.restore();
      }

      if (!reduce) raf = requestAnimationFrame(frame);
    }

    frame();
    let interval: ReturnType<typeof setInterval> | undefined;
    if (reduce) interval = setInterval(frame, 420);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (interval) clearInterval(interval);
    };
  }, [analyser]);

  const px = size * 2;
  return (
    <canvas
      ref={canvasRef}
      width={px}
      height={px}
      aria-hidden="true"
      style={{ width: size, height: size }}
    />
  );
}
