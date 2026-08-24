// Cada resposta da Parte 2/4 do piloto avalia um aspecto específico do item
// (readback vs. reação vs. confirmação, ou descrição vs. narrativa livre),
// mas todas compartilham o mesmo `prompt_id` — sem remapear, o "contexto"
// mandado pra IA seria sempre o mesmo texto genérico do item, mesmo achado já
// corrigido no controlador pro estágio `story_telling` (ver
// src/lib/ai/anthropic.ts). Usado tanto pelo feedback curto por resposta
// (route handler) quanto pela montagem dos transcripts do relatório final
// (actions.ts) — um só lugar pra essa regra.
import type { PilotResponseStage } from "@/types/database";

export type PilotPromptContextFields = {
  prompt_text: string;
  atc_audio_text: string | null;
  complication_text: string | null;
  atc_followup_audio_text: string | null;
  discussion_question: string | null;
  discussion_question_2: string | null;
  agree_disagree_statement: string | null;
};

const STATIC_CONTEXT: Partial<Record<PilotResponseStage, string>> = {
  narrative:
    "Describe what you think happened before or after this picture was taken (free narrative, not a literal description).",
  comparison:
    "Compare the three situations heard in Part 3 in terms of severity, possible solutions and prevention, and say which one is hardest to deal with.",
};

export function pilotResponseContext(
  stage: PilotResponseStage,
  prompt: PilotPromptContextFields,
): string {
  const staticText = STATIC_CONTEXT[stage];
  if (staticText) return staticText;

  switch (stage) {
    case "readback":
      return prompt.atc_audio_text ?? prompt.prompt_text;
    case "reaction":
      return prompt.complication_text ?? prompt.prompt_text;
    case "confirmation":
    case "report_back":
      return prompt.atc_followup_audio_text ?? prompt.prompt_text;
    case "question":
      return prompt.discussion_question ?? prompt.prompt_text;
    case "discussion_1":
      return prompt.discussion_question ?? prompt.prompt_text;
    case "discussion_2":
      return prompt.discussion_question_2 ?? prompt.prompt_text;
    case "agree_disagree":
      return prompt.agree_disagree_statement ?? prompt.prompt_text;
    default:
      return prompt.prompt_text;
  }
}
