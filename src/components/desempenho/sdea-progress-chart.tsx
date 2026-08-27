"use client";

import { useState } from "react";
import type { ProficiencyLevel } from "@/types/database";
import {
  PROFICIENCY_LEVELS as LEVEL_ORDER,
  PROFICIENCY_Y as LEVEL_Y,
  PROFICIENCY_LABEL as LEVEL_LABEL,
  PROFICIENCY_COLOR as LEVEL_COLOR,
} from "@/lib/proficiency-display";

// Cópia do Fase2ProgressChart (mesmo shape de dado — ProficiencyLevel, a
// mesma escala OACI de 4 níveis) pra trilha do piloto. Componente pequeno e
// autocontido, duplicado por segurança em vez de generalizado: evita mexer no
// componente já validado do controlador só pra parametrizar rótulos/rotas.
export type SdeaChartPoint = {
  attemptId: string;
  date: string;
  level: ProficiencyLevel;
};

const WIDTH = 640;
const HEIGHT = 220;
const PADDING_LEFT = 72;
const PADDING_BOTTOM = 28;
const PADDING_TOP = 16;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const PLOT_WIDTH = WIDTH - PADDING_LEFT - 16;

function yFor(level: ProficiencyLevel) {
  const step = PLOT_HEIGHT / (LEVEL_ORDER.length - 1);
  return PADDING_TOP + PLOT_HEIGHT - LEVEL_Y[level] * step;
}

export function SdeaProgressChart({ points }: { points: SdeaChartPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) return null;

  const chronological = [...points].reverse();
  const xFor = (i: number) =>
    chronological.length === 1
      ? PADDING_LEFT + PLOT_WIDTH / 2
      : PADDING_LEFT + (PLOT_WIDTH * i) / (chronological.length - 1);

  const linePath = chronological
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.level)}`)
    .join(" ");

  const hoveredPoint = hovered !== null ? chronological[hovered] : null;

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Progresso — nível geral por simulado
        </p>
        <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          {LEVEL_ORDER.map((level) => (
            <span key={level} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: LEVEL_COLOR[level] }}
              />
              {LEVEL_LABEL[level]}
            </span>
          ))}
        </div>
      </div>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Gráfico de progresso do SDEA: nível geral por simulado, na ordem cronológica"
          className="w-full"
        >
          {LEVEL_ORDER.map((level) => (
            <g key={level}>
              <line
                x1={PADDING_LEFT}
                x2={WIDTH - 16}
                y1={yFor(level)}
                y2={yFor(level)}
                stroke="currentColor"
                className="text-zinc-200 dark:text-zinc-800"
                strokeWidth={1}
              />
              <text
                x={PADDING_LEFT - 8}
                y={yFor(level) + 3}
                textAnchor="end"
                fontSize={10}
                className="fill-zinc-400 dark:fill-zinc-500"
              >
                {LEVEL_LABEL[level]}
              </text>
            </g>
          ))}

          <path d={linePath} fill="none" stroke="#a1a1aa" strokeWidth={2} />

          {chronological.map((point, i) => (
            <g key={point.attemptId}>
              <circle
                cx={xFor(i)}
                cy={yFor(point.level)}
                r={6}
                fill={LEVEL_COLOR[point.level]}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                tabIndex={0}
                className="cursor-pointer outline-none"
              />
              <text
                x={xFor(i)}
                y={HEIGHT - PADDING_BOTTOM + 14}
                textAnchor="middle"
                fontSize={10}
                className="fill-zinc-400 dark:fill-zinc-500"
              >
                {point.date}
              </text>
            </g>
          ))}
        </svg>

        {hoveredPoint && hovered !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900"
            style={{
              left: `${(xFor(hovered) / WIDTH) * 100}%`,
              top: `${(yFor(hoveredPoint.level) / HEIGHT) * 100}%`,
            }}
          >
            <p className="font-medium text-zinc-900 dark:text-zinc-50">{hoveredPoint.date}</p>
            <p className="text-zinc-500 dark:text-zinc-400">
              Nível {LEVEL_LABEL[hoveredPoint.level]}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
