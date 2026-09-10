import { createClient } from "@/lib/supabase/server";

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
