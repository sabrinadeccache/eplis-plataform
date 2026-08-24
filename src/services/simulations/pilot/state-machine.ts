// Lógica pura de avanço de posição (parte/item) da trilha do piloto/SDEA —
// mesmo padrão de src/services/simulations/phase2/state-machine.ts (função
// pura de ~10 linhas, sem dependência de servidor), mas com `PART_SIZES`
// próprios (3/5/3/1, não 4/10/4/1 do controlador). Duplicada em vez de
// generalizada de propósito: é pouco código, sensível a regressão, e não vale
// o risco de mexer no arquivo já testado do controlador só pra parametrizar
// tamanhos de parte.
import type { Part } from "@/types/database";

export const PART_ORDER: Part[] = ["part1", "part2", "part3", "part4"];
export const PART_SIZES: Record<Part, number> = { part1: 3, part2: 5, part3: 3, part4: 1 };

export const PART_INTRO_STATE: Record<Part, string> = {
  part1: "PILOT_PART_1_INTRO",
  part2: "PILOT_PART_2_INTRO",
  part3: "PILOT_PART_3_INTRO",
  part4: "PILOT_PART_4_INTRO",
};

export const PART_ITEM_STATE: Record<Part, string> = {
  part1: "PILOT_PART_1_QUESTION",
  part2: "PILOT_PART_2_SITUATION",
  part3: "PILOT_PART_3_SITUATION",
  part4: "PILOT_PART_4_ITEM",
};

export type NextPosition = { part: Part; itemIndex: number; stateLabel: string };

export function computeNextPosition(currentPart: Part, currentItemIndex: number): NextPosition | null {
  const size = PART_SIZES[currentPart];
  const nextItemIndex = currentItemIndex + 1;
  if (nextItemIndex < size) {
    return { part: currentPart, itemIndex: nextItemIndex, stateLabel: PART_ITEM_STATE[currentPart] };
  }
  const nextPartIdx = PART_ORDER.indexOf(currentPart) + 1;
  if (nextPartIdx >= PART_ORDER.length) return null;
  const nextPart = PART_ORDER[nextPartIdx];
  return { part: nextPart, itemIndex: 0, stateLabel: PART_INTRO_STATE[nextPart] };
}
