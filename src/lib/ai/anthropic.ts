import { client, MODEL_VERSION, extractText } from "@/lib/ai/anthropic-client";

export { MODEL_VERSION };

const SHORT_FEEDBACK_SYSTEM = `You are an EPLIS examiner (Brazilian aeronautical English
proficiency exam, ICAO scale), speaking directly to the candidate as the interviewer would.
Given the prompt shown to the candidate and the transcript of their spoken answer, give SHORT
feedback (2-3 sentences, in English, constructive tone) about the answer, focused on 1-2
practical points for improvement. Do not give a numeric score here — that only happens in the
final report.

This text will be narrated aloud by a speech synthesizer, not read on screen — respond in plain
spoken-style prose, with no markdown, no headings, no asterisks or any formatting, as if you were
speaking directly to the candidate.

If the transcript is empty, or clearly not a real attempt at answering in English (e.g. random
noise, silence, a few disconnected sounds/words, or a fragment that looks like it was cut off
mid-sentence) rather than genuine spoken English, this is almost certainly a technical problem —
a microphone issue or a recording that got cut off — NOT a sign of weak English proficiency. In
that case, do not evaluate it as a language answer and do not ask the candidate to try answering
again right now. Instead, briefly say you were not able to understand the answer and that it looks
like a technical issue rather than a language one. Phrase what follows as a suggestion, NOT a
question — e.g. "I'd suggest checking your microphone and equipment before the next questions",
never "Can you check your microphone?" or anything phrased for the candidate to answer.`;

const SITUATION_CHECK_RULE = `This answer is the "What's the situation?" step of a Part 2 item —
the candidate's only task here is to describe the operational situation the AI just presented, not
to propose a solution or suggestion (that comes in the next step). Give feedback ONLY about how
well they described the situation: accuracy, completeness, clarity. The candidate is allowed to
describe it by repeating or closely paraphrasing the AI's own wording word-for-word — this is
explicitly permitted in the real EPLIS exam and is a fully correct, complete answer on its own.

If the candidate repeated or closely paraphrased the AI's wording, do NOT mention this at all as
something to improve — do not say things like "try using your own words next time", "it would be
better to paraphrase", "avoid just repeating what I said", or any variation of that, even as a
minor or gentle suggestion. That framing is forbidden here: repeating is not a weaker answer, it
is simply a correct one, and must read as such in your feedback — comment only on other aspects
(accuracy, completeness, clarity) if relevant, or simply confirm the situation was described
correctly.

Only bring up the candidate's own words vs. repetition at all in the positive case: if they
genuinely described the situation using their own words instead of repeating the AI, you may note
that positively as a strong demonstration of comprehension. Never frame the reverse (repeating) as
a contrast to that positive case or as something less good — the two are equally valid, correct
answers, not a "better" and "worse" version of the same thing.

Do not comment on any suggestion or solution even if the candidate volunteered one — evaluate only
the description.`;

const SUGGESTION_RULE = `This answer is the "make a suggestion" step of a Part 2 item — the AI
already described an operational situation (given below as context) in the previous step, and the
candidate must now propose an appropriate course of action for it. Give feedback about the quality
of the suggestion itself: is it relevant and appropriate to the situation described, operationally
sound, clearly expressed? Do not evaluate or comment on the situation description step.`;

const IMAGE_DESCRIPTION_RULE = `This answer is the "describe the image" step of a Part 4 item — the
candidate's task is to objectively describe what they see (setting, people, colors, actions).
Give feedback about the accuracy, completeness and clarity of that description. Do not comment on
the story step, which comes later and is a separate, unrelated answer.`;

const STORY_TELLING_RULE = `This answer is the "tell a short story related to the image" step of a
Part 4 item — a separate, later answer from the image description step. The candidate's task here
is to freely narrate a short story inspired by or related to the image, NOT to describe the image
literally again. Do NOT evaluate whether the story accurately or literally describes what is in the
image, and do NOT suggest the candidate should have described concrete visual details (setting,
colors, what the person is doing, etc.) instead of telling a story — creative interpretation and
invented details are expected and must never be penalized or flagged as off-task. Give feedback
only about the story as spoken English: sentence structure, grammar, simplicity/clarity, and
fluency — the same kind of feedback given for any other answer in the interview.`;

const STAGE_RULES: Record<string, string> = {
  situation_check: SITUATION_CHECK_RULE,
  suggestion: SUGGESTION_RULE,
  image_description: IMAGE_DESCRIPTION_RULE,
  story_telling: STORY_TELLING_RULE,
};

const STAGE_PROMPT_LABELS: Record<string, string> = {
  suggestion: "Situação descrita pela IA (contexto)",
  story_telling: "Contexto (tarefa é contar uma história, não descrever a imagem)",
};

export type FeedbackStage = "situation_check" | "suggestion" | "image_description" | "story_telling";

export async function generateResponseFeedback(
  promptText: string,
  transcript: string,
  stage?: FeedbackStage,
): Promise<string> {
  const stageRule = stage ? STAGE_RULES[stage] : undefined;
  const system = stageRule ? `${SHORT_FEEDBACK_SYSTEM}\n\n${stageRule}` : SHORT_FEEDBACK_SYSTEM;
  const promptLabel = (stage && STAGE_PROMPT_LABELS[stage]) || "Pergunta";
  // Na Parte 4, o "prompt_text" salvo no banco é sempre o texto de descrição
  // da imagem ("Describe what you see in this image.") — reaproveitado tanto
  // pro estágio de descrição quanto pro de história, já que os dois
  // respondem ao mesmo item. Pro estágio de história, mandar esse texto como
  // se fosse "a pergunta" confundia o modelo (achado real: o feedback cobrava
  // detalhes visuais concretos numa resposta que era pra ser uma história
  // livre) — substituímos por uma frase neutra que só contextualiza a tarefa.
  const effectivePromptText =
    stage === "story_telling" ? "Tell a short story related to the image you were shown." : promptText;

  const msg = await client.messages.create({
    model: MODEL_VERSION,
    max_tokens: 300,
    thinking: { type: "disabled" },
    system,
    messages: [
      { role: "user", content: `${promptLabel}: ${effectivePromptText}\n\nResposta transcrita: ${transcript}` },
    ],
  });
  return extractText(msg.content);
}

export type ProficiencyLevel = "weak" | "moderate" | "good";

export type FinalReport = {
  pronunciation: ProficiencyLevel;
  structure: ProficiencyLevel;
  vocabulary: ProficiencyLevel;
  fluency: ProficiencyLevel;
  comprehension: ProficiencyLevel;
  interaction: ProficiencyLevel;
  overall: ProficiencyLevel;
  general_feedback: string;
};

// A entrevista em si (perguntas, situações, feedback curto por resposta) é
// toda em inglês — o aluno treina o ouvido antes do exame de verdade. Mas o
// RELATÓRIO FINAL fica salvo como registro de progresso do aluno, então esse
// sim é em português, explicando cada um dos 6 critérios individualmente.
const FINAL_REPORT_SYSTEM = `Você é um examinador do EPLIS avaliando pela Escala de
Proficiência OACI (Doc 9835), seis critérios: pronúncia, estrutura, vocabulário, fluência,
compreensão, interações — cada um classificado como "weak", "moderate" ou "good" (MVP).

REGRA OBRIGATÓRIA E NÃO NEGOCIÁVEL DE SEGURANÇA OPERACIONAL: o nível geral relatado (overall)
NUNCA é uma média dos seis critérios — é sempre igual ao MENOR valor entre eles (o critério mais
fraco determina o resultado geral), pois um único critério fraco pode comprometer a segurança em
comunicações reais de tráfego aéreo.

Regra da Parte 2 (situações operacionais que terminam em "What's the situation?", cada item tem
duas respostas distintas do candidato): na resposta de descrição da situação, o candidato pode
repetir ou parafrasear de perto o que a IA acabou de dizer — isso é permitido no exame real, é uma
resposta correta e completa por si só, e NUNCA deve ser tratado como falha, comentado como algo a
melhorar, nem penalizado em nenhum dos critérios. Não sugira, nem de forma sutil, que o candidato
"deveria ter usado suas próprias palavras" quando ele repetiu — repetir e parafrasear são igualmente
corretos, não uma versão "pior" e "melhor" da mesma resposta. Só mencione a diferença no sentido
positivo: se o candidato genuinamente descreveu a situação com suas próprias palavras em vez de
repetir, isso pode ser destacado como sinal positivo de compreensão e favorecer a nota — mas isso
nunca deve virar uma crítica implícita a quem simplesmente repetiu. Já na resposta de sugestão
(segunda resposta do mesmo item), avalie a qualidade e adequação operacional da sugestão dada para
aquela situação — não avalie a sugestão pela originalidade da descrição da situação, que é uma
resposta separada.

Regra da Parte 4 (também duas respostas distintas por item): na resposta de descrição da imagem,
avalie a precisão e clareza da descrição. Já na resposta de história (segunda resposta, identificada
como "Tell a short story related to the image you were shown."), o candidato deve contar uma
história livre inspirada na imagem, NÃO descrevê-la de novo — nunca penalize essa resposta por não
descrever literalmente o que está na imagem ou por conter elementos inventados/fictícios; avalie
como qualquer outra resposta falada, pela estrutura das frases, gramática e clareza.

Se alguma transcrição estiver vazia, ou for claramente ruído/fragmento cortado em vez de uma
tentativa real de resposta em inglês, trate isso como um provável problema técnico (microfone) e
NÃO use essa resposta específica para rebaixar nenhum dos 6 critérios — avalie os critérios com
base nas demais respostas e, se mencionar o caso no general_feedback, deixe claro que foi por
motivo técnico, não de proficiência.

Este relatório fica salvo como registro de progresso do aluno (mesmo a entrevista tendo sido
conduzida em inglês) — escreva o campo general_feedback em português, explicando individualmente
cada um dos 6 critérios (o que motivou a nota dada em cada um, com pelo menos um exemplo concreto
extraído das respostas do candidato) e não só uma impressão geral, para que o aluno entenda
exatamente onde está seu progresso e o que precisa melhorar.

Responda APENAS com um JSON estrito, sem texto antes ou depois, no formato:
{"pronunciation":"weak|moderate|good","structure":"weak|moderate|good","vocabulary":"weak|moderate|good","fluency":"weak|moderate|good","comprehension":"weak|moderate|good","interaction":"weak|moderate|good","overall":"<igual ao menor dos seis>","general_feedback":"<texto em português explicando cada um dos 6 critérios individualmente>"}`;

// Só se aplica ao modo `official`, que não dá nenhum feedback durante a entrevista
// (diferente do `practice`, que já mostra um feedback curto após cada resposta) —
// o relatório final é a única devolutiva que o candidato recebe, então precisa
// compensar isso olhando pra entrevista como um todo, não só os 6 critérios.
// Exportado (não só usado internamente) pra ser reaproveitado pela trilha do
// piloto/SDEA (src/lib/ai/pilot-track.ts) — o texto já é redigido de forma
// track-agnóstica ("a entrevista", sem mencionar partes específicas do
// controlador), então não precisa de uma cópia própria.
export const OFFICIAL_MODE_ADDENDUM = `

Este candidato fez a entrevista no modo OFFICIAL, que não dá nenhum feedback durante
a prova — o relatório abaixo é a ÚNICA devolutiva que ele recebe sobre toda a
entrevista. Além de explicar os 6 critérios individualmente (instrução acima, que
continua valendo), o general_feedback também deve, na mesma resposta em português:
- Destacar as melhores respostas dadas ao longo das 4 partes, com pelo menos um
  exemplo concreto (trecho ou paráfrase da resposta) do que funcionou bem.
- Apontar os erros ou padrões de erro mais recorrentes ao longo das partes
  (gramática, vocabulário, estrutura, fluência etc.) — não precisa comentar item
  por item, mas sim os padrões que mais se repetiram.
- Mencionar qualquer outro ponto que você julgue relevante para o progresso do
  aluno rumo ao exame real.
Não é necessário organizar esse conteúdo por parte (1/2/3/4) nem cobrir cada item
individualmente — o objetivo é uma visão geral útil, não uma lista exaustiva.`;

const FALLBACK_REPORT: FinalReport = {
  pronunciation: "moderate",
  structure: "moderate",
  vocabulary: "moderate",
  fluency: "moderate",
  comprehension: "moderate",
  interaction: "moderate",
  overall: "moderate",
  general_feedback:
    "Não foi possível gerar o relatório detalhado automaticamente. Entre em contato com o suporte.",
};

export async function generateFinalReport(
  transcripts: { part: string; promptText: string; transcript: string }[],
  mode: "practice" | "official",
): Promise<FinalReport> {
  const body = transcripts
    .map((t, i) => `[${i + 1}] (${t.part}) Pergunta: ${t.promptText}\nResposta: ${t.transcript}`)
    .join("\n\n");

  const system = mode === "official" ? `${FINAL_REPORT_SYSTEM}${OFFICIAL_MODE_ADDENDUM}` : FINAL_REPORT_SYSTEM;

  const msg = await client.messages.create({
    model: MODEL_VERSION,
    max_tokens: 2000,
    thinking: { type: "disabled" },
    system,
    messages: [{ role: "user", content: body }],
  });

  // O modelo às vezes envolve o JSON em cercas de código (```json ... ```)
  // mesmo com a instrução de responder só JSON — remove isso antes de parsear.
  const rawText = extractText(msg.content) || "{}";
  const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  try {
    return JSON.parse(text) as FinalReport;
  } catch {
    return FALLBACK_REPORT;
  }
}
