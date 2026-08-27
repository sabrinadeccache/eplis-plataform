import { client, MODEL_VERSION, extractText } from "@/lib/ai/anthropic-client";
import {
  OFFICIAL_MODE_ADDENDUM,
  PROFICIENCY_SCALE_PROMPT,
  normalizeFinalReport,
  type FinalReport,
} from "@/lib/ai/anthropic";

export { MODEL_VERSION };

// Mesmo tom/formato do feedback curto do controlador (ver anthropic.ts) —
// 2-3 frases, sem nota, em inglês, texto puro pra ser narrado por TTS, mesmo
// tratamento de transcrição vazia/ruído como provável problema técnico.
const SHORT_FEEDBACK_SYSTEM = `You are a Santos Dumont English Assessment (SDEA) examiner —
the Brazilian ANAC aeronautical English proficiency exam for pilots, ICAO scale — speaking
directly to the candidate as the interviewer would. Given the context shown to the candidate
and the transcript of their spoken answer, give SHORT feedback (2-3 sentences, in English,
constructive tone) about the answer, focused on 1-2 practical points for improvement. Do not
give a numeric score here — that only happens in the final report.

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
never "Can you check your microphone?" or anything phrased for the candidate to answer.

Important, exam-specific rule: the SDEA does NOT grade radiotelephony phraseology accuracy — the
official exam instructions state explicitly that oral production is not judged by technical or
operational precision, only by linguistic proficiency. Never comment on whether the candidate used
correct/standard aviation phraseology, and never suggest a "more correct" phraseology wording — only
evaluate the answer as spoken English (clarity, structure, grammar, fluency) and whether it
communicated the relevant facts.`;

// Regra da página 8 do modelo anotado do SDEA: nas etapas da Parte 2 em que o
// candidato atua como piloto, se a resposta claramente não é uma interação de
// piloto (ex.: comenta a tarefa, responde como aluno, descreve o que faria em
// vez de falar no rádio), sinalizar isso — no Practice já no feedback curto, no
// Official só no relatório final.
const NOT_AS_PILOT_RULE = ` Separately: in this Part 2 step the candidate must respond in role, as the
pilot speaking on the radio to the controller. If the answer is clearly not a pilot interaction at all
(e.g. they talk about the task, answer as a student, narrate what they would do instead of transmitting,
or otherwise step out of the role), point this out plainly — say that in Part 2 they must interact as
the pilot and that this answer did not fit the expected role — and still give what linguistic feedback
you can. Do NOT apply this to answers that are genuine pilot transmissions but use non-standard
phraseology; phraseology is never the issue.`;

const READBACK_RULE = `This answer is the "readback" step of a Part 2 role-play item — the
candidate, acting as the pilot, must repeat back the controller's instruction they just heard.
Give feedback ONLY about this as spoken English (clarity, structure) and whether the key facts from
the instruction were conveyed — do NOT evaluate or comment on phraseology correctness/standardness
(explicitly not graded in this exam, see system instructions).${NOT_AS_PILOT_RULE}`;

const REACTION_RULE = `This answer is the "reaction to an unexpected complication" step of a Part 2
role-play item — the candidate, acting as the pilot, must report a new problem to the controller
and state their intentions. Give feedback about how clearly and appropriately the problem and
intentions were communicated, as spoken English — not about the earlier readback step.${NOT_AS_PILOT_RULE}`;

const CONFIRMATION_RULE = `This answer is the "confirm or deny" step of a Part 2 role-play item —
the controller asked the candidate (as pilot) to confirm or deny a detail, and the candidate must
respond clearly (affirm/negative) and recap the relevant fact. Give feedback about whether that
confirmation/negation and recap was clear and accurate, as spoken English.${NOT_AS_PILOT_RULE}`;

const REPORT_BACK_RULE = `This answer is the "tell me everything the controller just said" step of
a Part 2 role-play item — the candidate must paraphrase, in their own words, everything the
controller said in the previous recording. This is primarily a comprehension check: give feedback
about the completeness and accuracy of what was reported, as well as clarity of the English used.`;

const REPORT_RULE = `This answer is the "tell me everything the pilot and the controller said" step
of a Part 3 item — the candidate just listened to a short recorded exchange between a pilot and a
controller (not a role-play; the candidate does not play the pilot here) and must recount it in
their own words. This is primarily a comprehension check: give feedback about the completeness and
accuracy of what was reported, as well as clarity of the English used.`;

const QUESTION_RULE = `This answer is the open technical/opinion question that follows a Part 3
situation — evaluate it as free spoken English (relevance, clarity, structure, fluency), same as
any other open answer in the interview.`;

const COMPARISON_RULE = `This answer is the closing comparison of the three Part 3 situations
(severity, possible solutions, prevention, which one is hardest to deal with) — evaluate it as free
spoken English, same as any other open answer.`;

const PICTURE_DESCRIPTION_RULE = `This answer is the "describe the picture" step of Part 4 — the
candidate's task is to objectively describe what they see. Give feedback about the accuracy,
completeness and clarity of that description. Do not comment on the later narrative/discussion
steps, which are separate, unrelated answers.`;

const NARRATIVE_RULE = `This answer is the "what happened before/after this picture" step of Part 4
— a separate, later answer from the picture description step. The candidate's task here is to
freely narrate a hypothesis inspired by the picture, NOT to describe it literally again. Do NOT
evaluate whether the narrative accurately or literally matches what is in the picture, and do NOT
suggest the candidate should have described concrete visual details instead — creative
interpretation and invented details are expected and must never be penalized or flagged as
off-task. Give feedback only about it as spoken English: sentence structure, grammar,
simplicity/clarity, and fluency.`;

const DISCUSSION_RULE = `This answer is an open discussion question about the Part 4 picture's
topic — evaluate it as free spoken English (relevance, clarity, structure, fluency).`;

const AGREE_DISAGREE_RULE = `This answer is the closing "agree or disagree with this statement"
step of Part 4 — evaluate the clarity of the opinion expressed and how well it is justified with
arguments/examples, as spoken English.`;

const STAGE_RULES: Record<string, string> = {
  readback: READBACK_RULE,
  reaction: REACTION_RULE,
  confirmation: CONFIRMATION_RULE,
  report_back: REPORT_BACK_RULE,
  report: REPORT_RULE,
  question: QUESTION_RULE,
  comparison: COMPARISON_RULE,
  picture_description: PICTURE_DESCRIPTION_RULE,
  narrative: NARRATIVE_RULE,
  discussion_1: DISCUSSION_RULE,
  discussion_2: DISCUSSION_RULE,
  agree_disagree: AGREE_DISAGREE_RULE,
};

export type PilotFeedbackStage =
  | "readback"
  | "reaction"
  | "confirmation"
  | "report_back"
  | "report"
  | "question"
  | "comparison"
  | "picture_description"
  | "narrative"
  | "discussion_1"
  | "discussion_2"
  | "agree_disagree";

export async function generatePilotResponseFeedback(
  referenceContext: string,
  transcript: string,
  stage?: PilotFeedbackStage,
): Promise<string> {
  const stageRule = stage ? STAGE_RULES[stage] : undefined;
  const system = stageRule ? `${SHORT_FEEDBACK_SYSTEM}\n\n${stageRule}` : SHORT_FEEDBACK_SYSTEM;

  const msg = await client.messages.create({
    model: MODEL_VERSION,
    max_tokens: 300,
    thinking: { type: "disabled" },
    system,
    messages: [{ role: "user", content: `Contexto: ${referenceContext}\n\nResposta transcrita: ${transcript}` }],
  });
  return extractText(msg.content);
}

// Mesma regra inegociável de segurança operacional do relatório final do
// controlador (nunca média, sempre o menor dos 6 critérios) — é uma regra da
// Escala OACI, não específica de nenhuma trilha.
const PILOT_FINAL_REPORT_SYSTEM = `Você é um examinador do Santos Dumont English Assessment (SDEA)
avaliando pela Escala de Proficiência OACI (Doc 9835), seis critérios: pronúncia, estrutura,
vocabulário, fluência, compreensão, interações. ${PROFICIENCY_SCALE_PROMPT}

REGRA OBRIGATÓRIA E NÃO NEGOCIÁVEL DE SEGURANÇA OPERACIONAL: o nível geral relatado (overall)
NUNCA é uma média dos seis critérios — é sempre igual ao MENOR valor entre eles (o critério mais
fraco determina o resultado geral), pois um único critério fraco pode comprometer a segurança em
comunicações reais de tráfego aéreo.

Regra específica deste exame: a produção oral do candidato NÃO é julgada pela precisão técnica ou
operacional — isso inclui fraseologia de radiotelefonia. Nunca rebaixe nenhum critério, nem
mencione no general_feedback, por causa de fraseologia incorreta ou não-padrão; avalie somente a
proficiência linguística em si (pronúncia, estrutura, vocabulário, fluência, compreensão,
interações).

Regra da Parte 2 (role-play em que o candidato interpreta o piloto, 4 respostas distintas por
item — readback, reação a um imprevisto, confirmação/negação, e um relato em discurso indireto do
que o controlador disse): avalie cada uma das 4 respostas pelo que ela especificamente pede, sem
misturar critérios de uma resposta na avaliação de outra do mesmo item. Se em alguma resposta da
Parte 2 o candidato claramente não interagiu como piloto (comentou a tarefa, respondeu como aluno,
narrou o que faria em vez de transmitir pelo rádio, ou saiu do papel de outra forma), registre isso
explicitamente no general_feedback — algo como "Na Part 2, você não interagiu como piloto e sua
resposta não se encaixou no perfil esperado" — sem que isso, por si só, rebaixe critério linguístico.
Fraseologia não-padrão nunca conta como "não interagiu como piloto".

Regra da Parte 3 (o candidato ouve um diálogo piloto/controlador e depois relata em discurso
indireto + responde uma pergunta técnica, com um turno final de comparação entre as 3 situações):
o relato em discurso indireto é principalmente um teste de compreensão — avalie completude e
precisão do que foi reportado, além da clareza do inglês usado.

Regra da Parte 4 (também múltiplas respostas por item — descrição da foto, hipótese de
antes/depois, perguntas de discussão, e concordar/discordar de uma afirmação): na resposta de
hipótese de antes/depois, o candidato deve narrar livremente, NÃO descrever a foto de novo —
nunca penalize essa resposta por não corresponder literalmente ao que está na foto ou por conter
elementos inventados; avalie como qualquer outra resposta falada, pela estrutura das frases,
gramática e clareza.

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
{"pronunciation":"weak|moderate|good|excellent","structure":"weak|moderate|good|excellent","vocabulary":"weak|moderate|good|excellent","fluency":"weak|moderate|good|excellent","comprehension":"weak|moderate|good|excellent","interaction":"weak|moderate|good|excellent","overall":"<igual ao menor dos seis>","general_feedback":"<texto em português explicando cada um dos 6 critérios individualmente>"}`;

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

export async function generatePilotFinalReport(
  transcripts: { part: string; promptText: string; transcript: string }[],
  mode: "practice" | "official",
): Promise<FinalReport> {
  const body = transcripts
    .map((t, i) => `[${i + 1}] (${t.part}) Contexto: ${t.promptText}\nResposta: ${t.transcript}`)
    .join("\n\n");

  const system =
    mode === "official" ? `${PILOT_FINAL_REPORT_SYSTEM}${OFFICIAL_MODE_ADDENDUM}` : PILOT_FINAL_REPORT_SYSTEM;

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
    return normalizeFinalReport(JSON.parse(text) as FinalReport);
  } catch {
    return FALLBACK_REPORT;
  }
}
