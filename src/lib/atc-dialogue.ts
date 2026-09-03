// Parser dos diálogos da Parte 3 do SDEA. O `prompt_text` da Parte 3 vem no
// formato "Pilot: <fala>. ATC: <fala>." (uma ou mais trocas) — usado pra separar
// as falas por interlocutor (ex.: uma voz por locutor na reprodução do diálogo).
// Função pura, sem dependências, pra poder ser testada e importada tanto pelo
// app quanto por um script .mjs.

export type DialogueSpeaker = "pilot" | "atc" | "narration";

export type DialogueSegment = {
  speaker: DialogueSpeaker;
  text: string;
};

const LABEL_RE = /(^|[\s.;])(pilot|atc)\s*:\s*/gi;

/**
 * Quebra um diálogo "Pilot: ... ATC: ..." em segmentos por interlocutor.
 * Texto sem nenhum rótulo vira um único segmento de narração.
 */
export function parseAtcDialogue(raw: string): DialogueSegment[] {
  const text = (raw ?? "").trim();
  if (!text) return [];

  const matches = [...text.matchAll(LABEL_RE)];
  if (matches.length === 0) {
    return [{ speaker: "narration", text }];
  }

  const segments: DialogueSegment[] = [];

  // Qualquer texto antes do primeiro rótulo é narração solta (não deve
  // acontecer com o conteúdo atual, mas não perde a informação se acontecer).
  const firstStart = matches[0].index ?? 0;
  const preamble = text.slice(0, firstStart).trim();
  if (preamble) segments.push({ speaker: "narration", text: preamble });

  matches.forEach((match, i) => {
    const speaker = match[2].toLowerCase() === "pilot" ? "pilot" : "atc";
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    const content = text.slice(contentStart, contentEnd).trim();
    if (content) segments.push({ speaker, text: content });
  });

  return segments;
}
