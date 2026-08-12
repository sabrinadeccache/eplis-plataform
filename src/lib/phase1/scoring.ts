// Critério de aprovação da Fase 1: 70% de acertos entre as questões respondidas
// no simulado (decisão da Sabrina, sem número fixo — a Fase 1 sorteia até 30
// questões do banco ativo, hoje só 10, então o total varia).
export const PASSING_RATIO = 0.7;

export function isApproved(score: number, total: number): boolean {
  if (total === 0) return false;
  return score / total >= PASSING_RATIO;
}
