// Estágios diferentes da Fase 2 compartilham o mesmo `prompt_id` (ex.: Parte 4
// — `image_description` e `story_telling` usam o mesmo texto no banco, "Describe
// what you see in this image."). Sem remapear, as telas de resultado/desempenho
// mostravam esse texto genérico como se fosse a pergunta de TODOS os estágios —
// inclusive o `story_telling`, que é pra contar uma história, não descrever
// (achado da Sabrina no teste). Mesma ideia do `pilotResponseContext` do SDEA.
import type { ResponseStage } from "@/types/database";

// Precisa bater com o remap do relatório final em src/lib/ai/anthropic.ts.
export const STORY_TELLING_QUESTION =
  "Tell a short story related to the image you were shown.";

const FIXED_QUESTION: Partial<Record<ResponseStage, string>> = {
  suggestion: "Make a suggestion.",
  story_telling: STORY_TELLING_QUESTION,
};

export function phase2ResponseQuestion(stage: ResponseStage, promptText: string): string {
  return FIXED_QUESTION[stage] ?? promptText;
}
