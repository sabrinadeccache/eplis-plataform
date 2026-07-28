"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { McqOption } from "@/types/database";

export async function startAttempt() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data, error } = await supabase
    .from("simulation_attempts")
    .insert({ user_id: auth.user.id, phase: "phase1", mode: "practice", status: "in_progress" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Não foi possível iniciar o simulado.");
  }

  redirect(`/fase1/simulado/${data.id}`);
}

async function assertOwnAttemptInProgress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  attemptId: string,
  userId: string,
) {
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, status")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== userId || attempt.status !== "in_progress") {
    throw new Error("Tentativa inválida ou já finalizada.");
  }
}

export async function recordAnswer(
  attemptId: string,
  questionId: string,
  selectedOption: McqOption,
) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Não autenticado.");

  await assertOwnAttemptInProgress(supabase, attemptId, auth.user.id);

  const { data: question } = await supabase
    .from("phase1_questions")
    .select("correct_option")
    .eq("id", questionId)
    .single();

  if (!question) throw new Error("Questão inválida.");

  const isCorrect = question.correct_option === selectedOption;

  await supabase.from("phase1_answers").insert({
    simulation_attempt_id: attemptId,
    question_id: questionId,
    selected_option: selectedOption,
    is_correct: isCorrect,
  });

  return { isCorrect };
}

export async function finishAttempt(attemptId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Não autenticado.");

  await assertOwnAttemptInProgress(supabase, attemptId, auth.user.id);

  const { count } = await supabase
    .from("phase1_answers")
    .select("id", { count: "exact", head: true })
    .eq("simulation_attempt_id", attemptId)
    .eq("is_correct", true);

  const score = count ?? 0;

  await supabase
    .from("simulation_attempts")
    .update({ status: "completed", finished_at: new Date().toISOString(), score })
    .eq("id", attemptId);

  return { score };
}
