import { type ProficiencyLevel, PROFICIENCY_ORDER } from "@/types/database";

// Rótulos e cores das 4 faixas da Escala OACI (MVP), centralizados pra não
// duplicar em cada tela de resultado/desempenho/gráfico.
//   weak=Fraco (N1-N3) · moderate=Moderado (N4) · good=Ótimo (N5) · excellent=Excelente (N6)

export const PROFICIENCY_LABEL: Record<ProficiencyLevel, string> = {
  weak: "Fraco",
  moderate: "Moderado",
  good: "Ótimo",
  excellent: "Excelente",
};

// Classes de badge (borda + texto) usadas nas telas de resultado e desempenho.
export const PROFICIENCY_BADGE_CLASS: Record<ProficiencyLevel, string> = {
  weak: "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400",
  moderate: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
  good: "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-400",
  excellent: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
};

// Hex pros gráficos de progresso (SVG).
export const PROFICIENCY_COLOR: Record<ProficiencyLevel, string> = {
  weak: "#ef4444",
  moderate: "#f59e0b",
  good: "#3b82f6",
  excellent: "#10b981",
};

// Ordem crescente + posição no eixo Y (0 = pior). Reexporta a ordem canônica.
export const PROFICIENCY_LEVELS = PROFICIENCY_ORDER;

export const PROFICIENCY_Y: Record<ProficiencyLevel, number> = {
  weak: 0,
  moderate: 1,
  good: 2,
  excellent: 3,
};
