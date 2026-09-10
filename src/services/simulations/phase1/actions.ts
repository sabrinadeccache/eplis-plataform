"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeOrRedirect } from "@/lib/auth/authorize";
import type { McqOption, SimulationMode } from "@/types/database";

const PRACTICE_COUNTS = [10, 20, 30];

export async function startAttempt(mode: SimulationMode, formData?: FormData) {
  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase, { track: "controller" });

  // Criação da tentativa vai via service_role — `authenticated` não escreve em
  // simulation_attempts (nem posição/estado forjados no INSERT).
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("simulation_attempts")
    .insert({ user_id: user.id, phase: "phase1", mode, status: "in_progress" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Não foi possível iniciar o simulado.");
  }

  if (mode === "practice") {
    const raw = Number(formData?.get("count"));
    const count = PRACTICE_COUNTS.includes(raw) ? raw : 10;
    redirect(`/fase1/simulado/${data.id}?n=${count}`);
  }

  redirect(`/fase1/simulado/${data.id}`);
}

// Retorna o `mode` da tentativa (usado pelo recordAnswer pra decidir se revela
// a resposta certa + transcrição no modo practice).
async function assertOwnAttemptInProgress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  attemptId: string,
  userId: string,
): Promise<SimulationMode> {
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, status, mode")
    .eq("id", attemptId)
    .single();

  if (!attempt || attempt.user_id !== userId || attempt.status !== "in_progress") {
    throw new Error("Tentativa inválida ou já finalizada.");
  }

  return attempt.mode as SimulationMode;
}

export type RecordAnswerResult = {
  isCorrect: boolean;
  // Só no modo practice, e só depois de a resposta ser gravada.
  correctOption?: McqOption;
  transcript?: string | null;
};

export async function recordAnswer(
  attemptId: string,
  questionId: string,
  selectedOption: McqOption,
): Promise<RecordAnswerResult> {
  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase, { track: "controller" });

  const mode = await assertOwnAttemptInProgress(supabase, attemptId, user.id);

  const { data: question } = await supabase
    .from("phase1_questions")
    .select("correct_option, audio_id")
    .eq("id", questionId)
    .single();

  if (!question) throw new Error("Questão inválida.");

  const isCorrect = question.correct_option === selectedOption;

  // `is_correct` é derivado aqui (opção escolhida vs. `correct_option`) e
  // gravado via service_role — `authenticated` não insere em phase1_answers,
  // senão daria pra forjar acertos e inflar o score.
  const admin = createAdminClient();
  await admin.from("phase1_answers").insert({
    simulation_attempt_id: attemptId,
    question_id: questionId,
    selected_option: selectedOption,
    is_correct: isCorrect,
  });

  if (mode === "practice") {
    const { data: audio } = await supabase
      .from("phase1_audios")
      .select("transcript")
      .eq("id", question.audio_id)
      .single();
    return {
      isCorrect,
      correctOption: question.correct_option,
      transcript: audio?.transcript ?? null,
    };
  }

  return { isCorrect };
}

export async function finishAttempt(attemptId: string) {
  const supabase = await createClient();
  const { user } = await authorizeOrRedirect(supabase, { track: "controller" });

  await assertOwnAttemptInProgress(supabase, attemptId, user.id);

  const { count } = await supabase
    .from("phase1_answers")
    .select("id", { count: "exact", head: true })
    .eq("simulation_attempt_id", attemptId)
    .eq("is_correct", true);

  const score = count ?? 0;

  // Nota e ciclo de vida da tentativa são gravados só pelo servidor
  // (service_role) — o role `authenticated` está bloqueado por trigger/RLS.
  const admin = createAdminClient();
  await admin
    .from("simulation_attempts")
    .update({ status: "completed", finished_at: new Date().toISOString(), score })
    .eq("id", attemptId)
    .eq("user_id", user.id);

  return { score };
}
