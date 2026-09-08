// Cada resposta da Parte 2/4 do piloto avalia um aspecto específico do item
// (readback vs. reação vs. confirmação, ou descrição vs. narrativa livre),
// mas todas compartilham o mesmo `prompt_id` — sem remapear, o "contexto"
// mandado pra IA seria sempre o mesmo texto genérico do item, mesmo achado já
// corrigido no controlador pro estágio `story_telling` (ver
// src/lib/ai/anthropic.ts). Usado tanto pelo feedback curto por resposta
// (route handler) quanto pela montagem dos transcripts do relatório final
// (actions.ts) — um só lugar pra essa regra.
import type { PilotResponseStage } from "@/types/database";

// Perguntas fixas da Parte 4 (não vêm do banco — só a afirmação de
// concordar/discordar é específica da foto). Fonte única: importadas pelo
// runner (pilot-interview-runner.tsx) e usadas aqui pra dar o contexto certo
// à IA e às telas de resultado/desempenho, que antes mostravam sempre o
// texto genérico "Please describe this picture to me." em todos os estágios.
export const PART4_DISCUSSION_1 =
  "How serious do you think a situation like the one in this picture can be, and what makes it more or less dangerous?";
export const PART4_DISCUSSION_2 =
  "What consequences can a situation like this have for other flights, for the airport, or for aviation in general, and how could it be prevented?";
export const PART4_NARRATIVE_BEFORE_VARIATIONS = [
  "What do you think happened before this picture was taken?",
  "What do you think the people in this picture were doing before it was taken?",
  "What do you think was happening just before this picture was taken?",
  "Can you create a short story based on this picture? Use your imagination.",
];
export const PART4_NARRATIVE_AFTER =
  "Now imagine that this picture has just been taken. What do you think will happen next?";

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
  discussion_1: PART4_DISCUSSION_1,
  discussion_2: PART4_DISCUSSION_2,
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
    case "agree_disagree":
      return prompt.agree_disagree_statement ?? prompt.prompt_text;
    default:
      return prompt.prompt_text;
  }
}
