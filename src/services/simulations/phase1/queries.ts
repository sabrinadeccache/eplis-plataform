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

// Correct_option is intentionally excluded from the select — grading happens
// server-side in recordAnswer, never trusting a client-supplied answer against
// a client-visible key. `limit` deixa o modo practice sortear menos questões
// (10/20/30); o official sempre usa MAX_QUESTIONS.
export async function getRandomQuizQuestions(
  limit: number = MAX_QUESTIONS,
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

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  const take = Math.max(1, Math.min(Math.trunc(limit) || MAX_QUESTIONS, MAX_QUESTIONS));
  return items.slice(0, take);
}
