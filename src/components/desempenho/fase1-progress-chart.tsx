"use client";

import { useState } from "react";
import { PASSING_RATIO } from "@/lib/phase1/scoring";

export type Fase1ChartPoint = {
  attemptId: string;
  date: string;
  percent: number;
  approved: boolean;
};

const WIDTH = 640;
const HEIGHT = 220;
const PADDING_LEFT = 36;
const PADDING_BOTTOM = 28;
const PADDING_TOP = 12;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const PLOT_WIDTH = WIDTH - PADDING_LEFT - 8;

const APPROVED_FILL = "#10b981";
const REJECTED_FILL = "#ef4444";
const THRESHOLD_STROKE = "#a1a1aa";

export function Fase1ProgressChart({ points }: { points: Fase1ChartPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) return null;

  const chronological = [...points].reverse();
  const barSlot = PLOT_WIDTH / chronological.length;
  const barWidth = Math.min(36, barSlot * 0.6);
  const thresholdY = PADDING_TOP + PLOT_HEIGHT * (1 - PASSING_RATIO);
  const hoveredPoint = hovered !== null ? chronological[hovered] : null;

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Progresso — % de acertos por simulado
        </p>
        <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: APPROVED_FILL }}
            />
            Aprovado
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: REJECTED_FILL }}
            />
            Reprovado
          </span>
        </div>
      </div>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Gráfico de progresso da Fase 1: percentual de acertos por simulado, na ordem cronológica"
          className="w-full"
        >
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = PADDING_TOP + PLOT_HEIGHT * (1 - tick / 100);
            return (
              <g key={tick}>
                <line
                  x1={PADDING_LEFT}
                  x2={WIDTH - 4}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800"
                  strokeWidth={1}
                />
                <text
                  x={PADDING_LEFT - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  className="fill-zinc-400 dark:fill-zinc-500"
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          <line
            x1={PADDING_LEFT}
            x2={WIDTH - 4}
            y1={thresholdY}
            y2={thresholdY}
            stroke={THRESHOLD_STROKE}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <text
            x={WIDTH - 4}
            y={thresholdY - 4}
            textAnchor="end"
            fontSize={10}
            className="fill-zinc-400 dark:fill-zinc-500"
          >
            corte de aprovação (70%)
          </text>

          {chronological.map((point, i) => {
            const barHeight = Math.max(2, PLOT_HEIGHT * (point.percent / 100));
            const x = PADDING_LEFT + barSlot * i + (barSlot - barWidth) / 2;
            const y = PADDING_TOP + PLOT_HEIGHT - barHeight;
            return (
              <g key={point.attemptId}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={4}
                  fill={point.approved ? APPROVED_FILL : REJECTED_FILL}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                  tabIndex={0}
                  className="cursor-pointer outline-none"
                />
                <text
                  x={x + barWidth / 2}
                  y={HEIGHT - PADDING_BOTTOM + 14}
                  textAnchor="middle"
                  fontSize={10}
                  className="fill-zinc-400 dark:fill-zinc-500"
                >
                  {point.date}
                </text>
              </g>
            );
          })}
        </svg>

        {hoveredPoint && hovered !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900"
            style={{
              left: `${((PADDING_LEFT + barSlot * hovered + barSlot / 2) / WIDTH) * 100}%`,
              top: `${((PADDING_TOP + PLOT_HEIGHT * (1 - hoveredPoint.percent / 100)) / HEIGHT) * 100}%`,
            }}
          >
            <p className="font-medium text-zinc-900 dark:text-zinc-50">{hoveredPoint.date}</p>
            <p className="text-zinc-500 dark:text-zinc-400">
              {Math.round(hoveredPoint.percent)}% de acertos —{" "}
              {hoveredPoint.approved ? "Aprovado" : "Reprovado"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
