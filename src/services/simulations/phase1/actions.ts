"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeOrRedirect } from "@/lib/auth/authorize";
import { assertPhase1CompletionCount, currentPhase1QuestionId, getRandomQuizQuestions, phase1SequenceIds } from "@/services/simulations/phase1/queries";
import type { McqOption, SimulationMode } from "@/types/database";

const PRACTICE_COUNTS = [10, 20, 30];
const OFFICIAL_COUNT = 30;

export async function startAttempt(mode: SimulationMode, formData?: FormData) {
  if (mode !== "practice" && mode !== "official") throw new Error("Modo inválido.");
  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase, { track: "controller" });

  const { data: existing } = await supabase
    .from("simulation_attempts")
    .select("id")
    .eq("user_id", user.id)
    .eq("phase", "phase1")
    .eq("mode", mode)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) redirect(`/fase1/simulado/${existing.id}`);

  const raw = Number(formData?.get("count"));
  const count = mode === "practice" && PRACTICE_COUNTS.includes(raw) ? raw : OFFICIAL_COUNT;
  const questions = await getRandomQuizQuestions(count, user.id);
  if (questions.length !== count) {
    throw new Error(`Não há ${count} questões disponíveis para iniciar este simulado.`);
  }

  const attemptId = crypto.randomUUID();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("simulation_attempts")
    .insert({
      id: attemptId,
      user_id: user.id,
      phase: "phase1",
      mode,
      status: "in_progress",
      current_item_index: 0,
      item_sequence: { phase1: questions.map((question) => question.id) },
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    const { data: winner } = await supabase
      .from("simulation_attempts")
      .select("id")
      .eq("user_id", user.id)
      .eq("phase", "phase1")
      .eq("mode", mode)
      .eq("status", "in_progress")
      .limit(1)
      .single();
    if (winner) redirect(`/fase1/simulado/${winner.id}`);
  }
  if (error || !data) throw new Error("Não foi possível iniciar o simulado.");
  redirect(`/fase1/simulado/${data.id}`);
}

type Attempt = { id: string; mode: SimulationMode; item_sequence: unknown };

async function assertOwnAttemptInProgress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  attemptId: string,
  userId: string,
): Promise<Attempt> {
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status, mode, item_sequence")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== userId || attempt.phase !== "phase1" || attempt.status !== "in_progress") {
    throw new Error("Tentativa inválida ou já finalizada.");
  }
  return attempt as Attempt;
}

// Compatibilidade para a tentativa parcial criada antes da M4. Não existe
// informação suficiente para recuperar itens ainda não respondidos que só
// viviam no estado do browser; preservamos as respostas existentes como
// prefixo e congelamos o restante uma única vez por compare-and-set.
export async function ensurePhase1Sequence(attemptId: string): Promise<string[]> {
  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase, { track: "controller" });
  const attempt = await assertOwnAttemptInProgress(supabase, attemptId, user.id);
  const existing = phase1SequenceIds(attempt.item_sequence);
  if (existing.length) return existing;

  const { data: answers, error } = await supabase
    .from("phase1_answers")
    .select("question_id")
    .eq("simulation_attempt_id", attemptId)
    .order("created_at", { ascending: true });
  if (error) throw new Error("Não foi possível recuperar o progresso anterior.");

  const answered = [...new Set((answers ?? []).map((row) => row.question_id))];
  const practiceCount = PRACTICE_COUNTS.find((count) => count >= Math.max(answered.length, 10)) ?? 30;
  const count = attempt.mode === "official" ? OFFICIAL_COUNT : practiceCount;
  const drawn = await getRandomQuizQuestions(count, user.id);
  const sequence = [...answered, ...drawn.map((question) => question.id).filter((id) => !answered.includes(id))].slice(0, count);
  if (sequence.length !== count) throw new Error("Não há questões suficientes para recuperar a tentativa.");

  const admin = createAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("simulation_attempts")
    .update({ item_sequence: { phase1: sequence }, current_item_index: answered.length })
    .eq("id", attemptId)
    .is("item_sequence", null)
    .select("item_sequence")
    .maybeSingle();
  if (updateError) throw new Error("Não foi possível congelar a sequência da tentativa.");
  if (updated) return phase1SequenceIds(updated.item_sequence);

  const { data: winner } = await admin.from("simulation_attempts").select("item_sequence").eq("id", attemptId).single();
  const winnerIds = phase1SequenceIds(winner?.item_sequence);
  if (!winnerIds.length) throw new Error("Não foi possível recuperar a sequência da tentativa.");
  return winnerIds;
}

export type RecordAnswerResult = {
  isCorrect: boolean;
  correctOption?: McqOption;
  transcript?: string | null;
};

async function answerResult(
  mode: SimulationMode,
  question: { correct_option: McqOption; audio_id: string },
  isCorrect: boolean,
): Promise<RecordAnswerResult> {
  if (mode !== "practice") return { isCorrect };
  const admin = createAdminClient();
  const { data: audio } = await admin.from("phase1_audios").select("transcript").eq("id", question.audio_id).single();
  return { isCorrect, correctOption: question.correct_option, transcript: audio?.transcript ?? null };
}

export async function recordAnswer(
  attemptId: string,
  questionId: string,
  selectedOption: McqOption | null,
): Promise<RecordAnswerResult> {
  if (selectedOption !== null && !(["a", "b", "c"] as const).includes(selectedOption)) {
    throw new Error("Resposta inválida.");
  }

  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase, { track: "controller" });
  const attempt = await assertOwnAttemptInProgress(supabase, attemptId, user.id);
  if (attempt.mode === "practice" && selectedOption === null) throw new Error("Selecione uma resposta.");

  const sequence = phase1SequenceIds(attempt.item_sequence);
  if (sequence.length === 0) throw new Error("Tentativa sem sequência persistida.");

  const { data: answers, error: answersError } = await supabase
    .from("phase1_answers")
    .select("question_id, is_correct")
    .eq("simulation_attempt_id", attemptId)
    .order("created_at", { ascending: true });
  if (answersError) throw new Error("Não foi possível validar o progresso da tentativa.");

  const admin = createAdminClient();
  const { data: question } = await admin
    .from("phase1_questions")
    .select("correct_option, audio_id")
    .eq("id", questionId)
    .single();
  if (!question) throw new Error("Questão inválida.");

  const prior = (answers ?? []).find((answer) => answer.question_id === questionId);
  if (prior) return answerResult(attempt.mode, question, prior.is_correct);
  const currentQuestionId = currentPhase1QuestionId(sequence, (answers ?? []).map((answer) => answer.question_id));
  if (currentQuestionId !== questionId) throw new Error("Esta não é a questão corrente da tentativa.");

  const isCorrect = selectedOption !== null && question.correct_option === selectedOption;
  const { data: inserted, error } = await admin
    .from("phase1_answers")
    .insert({ simulation_attempt_id: attemptId, question_id: questionId, selected_option: selectedOption, is_correct: isCorrect })
    .select("is_correct")
    .single();

  if (error?.code === "23505") {
    const { data: winner } = await admin
      .from("phase1_answers")
      .select("is_correct")
      .eq("simulation_attempt_id", attemptId)
      .eq("question_id", questionId)
      .single();
    if (winner) return answerResult(attempt.mode, question, winner.is_correct);
  }
  if (error || !inserted) throw new Error("Não foi possível registrar a resposta.");
  return answerResult(attempt.mode, question, inserted.is_correct);
}

export async function finishAttempt(attemptId: string) {
  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase, { track: "controller" });
  const attempt = await assertOwnAttemptInProgress(supabase, attemptId, user.id);
  const sequence = phase1SequenceIds(attempt.item_sequence);
  if (sequence.length === 0) throw new Error("Tentativa sem sequência persistida.");

  const [{ count: total, error: totalError }, { count: correct, error: correctError }] = await Promise.all([
    supabase.from("phase1_answers").select("id", { count: "exact", head: true }).eq("simulation_attempt_id", attemptId),
    supabase.from("phase1_answers").select("id", { count: "exact", head: true }).eq("simulation_attempt_id", attemptId).eq("is_correct", true),
  ]);
  if (totalError || correctError) throw new Error("Não foi possível validar as respostas.");
  assertPhase1CompletionCount(sequence, total ?? 0);

  const score = correct ?? 0;
  const admin = createAdminClient();
  const { error } = await admin
    .from("simulation_attempts")
    .update({ status: "completed", finished_at: new Date().toISOString(), score, current_item_index: sequence.length })
    .eq("id", attemptId)
    .eq("user_id", user.id)
    .eq("status", "in_progress");
  if (error) throw new Error("Não foi possível finalizar o simulado.");
  return { score };
}

export async function abandonAttempt(attemptId: string) {
  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase, { track: "controller" });
  const admin = createAdminClient();
  const { error } = await admin
    .from("simulation_attempts")
    .update({ status: "abandoned", finished_at: new Date().toISOString() })
    .eq("id", attemptId)
    .eq("user_id", user.id)
    .eq("phase", "phase1")
    .eq("status", "in_progress");
  if (error) throw new Error("Não foi possível abandonar a tentativa.");
  revalidatePath("/fase1");
  redirect("/fase1");
}
