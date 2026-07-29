// Lógica pura de avanço de posição (parte/item) da entrevista da Fase 2 —
// sem dependências de servidor, reutilizável tanto pela Server Action
// (actions.ts) quanto pelo client component (interview-runner.tsx) para
// manter os dois lados sincronizados sem duplicar a regra.
import type { Part } from "@/types/database";

export const PART_ORDER: Part[] = ["part1", "part2", "part3", "part4"];
export const PART_SIZES: Record<Part, number> = { part1: 4, part2: 10, part3: 4, part4: 1 };

export const PART_INTRO_STATE: Record<Part, string> = {
  part1: "PART_1_INTRO",
  part2: "PART_2_INTRO",
  part3: "PART_3_INTRO",
  part4: "PART_4_INTRO",
};

export const PART_ITEM_STATE: Record<Part, string> = {
  part1: "PART_1_QUESTION",
  part2: "PART_2_SCENARIO",
  part3: "PART_3_QUESTION",
  part4: "PART_4_ITEM",
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
