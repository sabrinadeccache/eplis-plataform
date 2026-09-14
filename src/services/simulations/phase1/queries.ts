import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Phase1QuizItem = {
  id: string;
  audioUrl: string;
  prompt: string;
  optionA: string;
  optionB: string;
  optionC: string;
};

const MAX_QUESTIONS = 30;

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Ids das perguntas que o usuário já respondeu em qualquer tentativa anterior
// da Fase 1 (practice ou official). Usado pra não repetir conteúdo enquanto
// ainda houver pergunta inédita no pool. Falha "aberto" (Set vazio) se a
// consulta der erro — repetir é melhor do que não conseguir iniciar o simulado.
async function seenQuestionIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Set<string>> {
  const { data: attempts, error: attemptsError } = await supabase
    .from("simulation_attempts")
    .select("id")
    .eq("user_id", userId)
    .eq("phase", "phase1");

  if (attemptsError || !attempts || attempts.length === 0) return new Set();

  const { data: answers, error: answersError } = await supabase
    .from("phase1_answers")
    .select("question_id")
    .in(
      "simulation_attempt_id",
      attempts.map((a) => a.id as string),
    );

  if (answersError || !answers) return new Set();

  return new Set(answers.map((row) => row.question_id as string));
}

// Correct_option is intentionally excluded from the select — grading happens
// server-side in recordAnswer, never trusting a client-supplied answer against
// a client-visible key. `limit` deixa o modo practice sortear menos questões
// (10/20/30); o official sempre usa MAX_QUESTIONS.
//
// Passando `userId`, o sorteio prioriza perguntas que o usuário ainda não
// respondeu: só volta a incluir perguntas já vistas quando as inéditas
// acabam (aí recomeça o ciclo, embaralhado). Sem `userId`, é sorteio puro.
export async function getRandomQuizQuestions(
  limit: number = MAX_QUESTIONS,
  userId?: string,
): Promise<Phase1QuizItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phase1_questions")
    .select("id, prompt, option_a, option_b, option_c, phase1_audios(audio_url)")
    .eq("is_active", true);

  if (error || !data) return [];

  const items: Phase1QuizItem[] = data
    .map((row: Record<string, unknown>) => {
      const audio = row.phase1_audios as { audio_url?: string } | null;
      if (!audio?.audio_url) return null;
      return {
        id: row.id as string,
        audioUrl: audio.audio_url,
        prompt: row.prompt as string,
        optionA: row.option_a as string,
        optionB: row.option_b as string,
        optionC: row.option_c as string,
      };
    })
    .filter((item): item is Phase1QuizItem => item !== null);

  shuffle(items);

  if (userId) {
    const seen = await seenQuestionIds(supabase, userId);
    if (seen.size > 0) {
      const fresh = items.filter((item) => !seen.has(item.id));
      const repeats = items.filter((item) => seen.has(item.id));
      items.length = 0;
      items.push(...fresh, ...repeats);
    }
  }

  const take = Math.max(1, Math.min(Math.trunc(limit) || MAX_QUESTIONS, MAX_QUESTIONS));
  return items.slice(0, take);
}

export function phase1SequenceIds(itemSequence: unknown): string[] {
  if (!itemSequence || typeof itemSequence !== "object" || Array.isArray(itemSequence)) return [];
  const ids = (itemSequence as Record<string, unknown>).phase1;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return [];
  if (ids.length > MAX_QUESTIONS || new Set(ids).size !== ids.length) return [];
  return [...ids];
}

export function currentPhase1QuestionId(sequence: string[], answeredQuestionIds: string[]): string | null {
  if (new Set(answeredQuestionIds).size !== answeredQuestionIds.length) {
    throw new Error("Progresso inconsistente: questão respondida mais de uma vez.");
  }
  const answered = new Set(answeredQuestionIds);
  const expectedPrefix = sequence.slice(0, answeredQuestionIds.length);
  if (expectedPrefix.some((id) => !answered.has(id)) || answeredQuestionIds.some((id) => !expectedPrefix.includes(id))) {
    throw new Error("Progresso inconsistente com a sequência persistida.");
  }
  return sequence[answeredQuestionIds.length] ?? null;
}

export function assertPhase1CompletionCount(sequence: string[], answerCount: number): void {
  if (sequence.length === 0 || answerCount !== sequence.length) {
    throw new Error("Ainda há questões pendentes.");
  }
}

// A sequência já foi autorizada e congelada na tentativa. O admin client é
// intencional aqui: uma pergunta desativada depois do início precisa continuar
// disponível naquela tentativa, mas nunca enviamos correct_option ao runner.
export async function getQuizQuestionsByIds(questionIds: string[]): Promise<Phase1QuizItem[]> {
  if (questionIds.length === 0) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("phase1_questions")
    .select("id, prompt, option_a, option_b, option_c, phase1_audios(audio_url)")
    .in("id", questionIds);

  if (error || !data) throw new Error("Não foi possível carregar as questões da tentativa.");

  const byId = new Map<string, Phase1QuizItem>();
  for (const row of data as Record<string, unknown>[]) {
    const audio = row.phase1_audios as { audio_url?: string } | null;
    if (!audio?.audio_url) continue;
    byId.set(row.id as string, {
      id: row.id as string,
      audioUrl: audio.audio_url,
      prompt: row.prompt as string,
      optionA: row.option_a as string,
      optionB: row.option_b as string,
      optionC: row.option_c as string,
    });
  }

  const ordered = questionIds.map((id) => byId.get(id)).filter((item): item is Phase1QuizItem => Boolean(item));
  if (ordered.length !== questionIds.length) {
    throw new Error("A tentativa referencia uma questão indisponível. Contate o suporte.");
  }
  return ordered;
}
