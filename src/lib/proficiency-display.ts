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

// Código da Escala OACI equivalente, pra exibição como dado (mono).
export const PROFICIENCY_ICAO: Record<ProficiencyLevel, string> = {
  weak: "N1–N3",
  moderate: "N4",
  good: "N5",
  excellent: "N6",
};

// Classe de pílula (borda + texto + fundo suave) usada nas telas de
// resultado e desempenho. Cores derivadas dos tokens semânticos.
export const PROFICIENCY_BADGE_CLASS: Record<ProficiencyLevel, string> = {
  weak: "border-danger/40 bg-danger/10 text-danger",
  moderate: "border-caution/40 bg-caution/10 text-caution",
  good: "border-brand/40 bg-brand/10 text-brand",
  excellent: "border-success/40 bg-success/10 text-success",
};

// Hex pros gráficos de progresso (SVG).
export const PROFICIENCY_COLOR: Record<ProficiencyLevel, string> = {
  weak: "#b4231e",
  moderate: "#c98a00",
  good: "#1668b3",
  excellent: "#1c7c54",
};

// Ordem crescente + posição no eixo Y (0 = pior). Reexporta a ordem canônica.
export const PROFICIENCY_LEVELS = PROFICIENCY_ORDER;

export const PROFICIENCY_Y: Record<ProficiencyLevel, number> = {
  weak: 0,
  moderate: 1,
  good: 2,
  excellent: 3,
};
