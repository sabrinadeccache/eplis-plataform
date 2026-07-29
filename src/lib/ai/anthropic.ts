import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export const MODEL_VERSION = "claude-sonnet-5";

// Extrai o primeiro bloco de texto da resposta. Sonnet 5 usa "thinking"
// adaptativo por padrão — quando o modelo decide pensar, `content[0]` pode ser
// um bloco de raciocínio em vez do texto, então indexar direto em [0] deixava
// o feedback vazio de forma intermitente (bug real observado: feedback sumia
// em algumas respostas e aparecia em outras). Desabilitamos thinking nas duas
// chamadas abaixo (não precisamos de raciocínio pra feedback curto/JSON), e
// ainda assim buscamos o bloco de texto explicitamente como defesa extra.
function extractText(content: Anthropic.ContentBlock[]): string {
  const block = content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text : "";
}

const SHORT_FEEDBACK_SYSTEM = `You are an EPLIS examiner (Brazilian aeronautical English
proficiency exam, ICAO scale), speaking directly to the candidate as the interviewer would.
Given the prompt shown to the candidate and the transcript of their spoken answer, give SHORT
feedback (2-3 sentences, in English, constructive tone) about the answer, focused on 1-2
practical points for improvement. Do not give a numeric score here — that only happens in the
final report.

Part 2 rule: when the prompt is an operational situation ending in "What's the situation?", the
candidate is allowed to describe the situation by repeating or closely paraphrasing the AI's own
wording — this is explicitly permitted in the real EPLIS exam and must NEVER be treated as a flaw
or flagged as unoriginal.

This text will be narrated aloud by a speech synthesizer, not read on screen — respond in plain
spoken-style prose, with no markdown, no headings, no asterisks or any formatting, as if you were
speaking directly to the candidate.`;

export async function generateResponseFeedback(promptText: string, transcript: string): Promise<string> {
  const msg = await client.messages.create({
    model: MODEL_VERSION,
    max_tokens: 300,
    thinking: { type: "disabled" },
    system: SHORT_FEEDBACK_SYSTEM,
    messages: [
      { role: "user", content: `Pergunta: ${promptText}\n\nResposta transcrita: ${transcript}` },
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

Regra da Parte 2 (situações operacionais que terminam em "What's the situation?"): o candidato
pode descrever a situação repetindo ou parafraseando de perto o que a IA acabou de dizer — isso é
permitido no exame real e NUNCA deve ser tratado como falha ou penalizado em nenhum dos critérios.

Este relatório fica salvo como registro de progresso do aluno (mesmo a entrevista tendo sido
conduzida em inglês) — escreva o campo general_feedback em português, explicando individualmente
cada um dos 6 critérios (o que motivou a nota dada em cada um, com pelo menos um exemplo concreto
extraído das respostas do candidato) e não só uma impressão geral, para que o aluno entenda
exatamente onde está seu progresso e o que precisa melhorar.

Responda APENAS com um JSON estrito, sem texto antes ou depois, no formato:
{"pronunciation":"weak|moderate|good","structure":"weak|moderate|good","vocabulary":"weak|moderate|good","fluency":"weak|moderate|good","comprehension":"weak|moderate|good","interaction":"weak|moderate|good","overall":"<igual ao menor dos seis>","general_feedback":"<texto em português explicando cada um dos 6 critérios individualmente>"}`;

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
): Promise<FinalReport> {
  const body = transcripts
    .map((t, i) => `[${i + 1}] (${t.part}) Pergunta: ${t.promptText}\nResposta: ${t.transcript}`)
    .join("\n\n");

  const msg = await client.messages.create({
    model: MODEL_VERSION,
    max_tokens: 2000,
    thinking: { type: "disabled" },
    system: FINAL_REPORT_SYSTEM,
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
