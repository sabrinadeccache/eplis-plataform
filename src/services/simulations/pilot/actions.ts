"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateSpeechAudio } from "@/lib/ai/openai";
import { generatePilotFinalReport, MODEL_VERSION } from "@/lib/ai/pilot-track";
import { computeNextPosition } from "@/services/simulations/pilot/state-machine";
import { pilotResponseContext } from "@/services/simulations/pilot/context";
import { PILOT_DAILY_ATTEMPT_LIMIT, countAttemptsToday } from "@/services/simulations/pilot/limits";
import {
  assertOwnAttemptInProgress as assertOwnAttemptInProgressShared,
  type SupabaseServerClient,
} from "@/lib/simulations/attempt-guards";
import type { Part, PilotResponseStage, SimulationMode } from "@/types/database";

export async function assertOwnAttemptInProgress(
  supabase: SupabaseServerClient,
  attemptId: string,
  userId: string,
) {
  return assertOwnAttemptInProgressShared(supabase, attemptId, userId, "pilot_interview");
}

export async function startAttempt(mode: SimulationMode) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const attemptsToday = await countAttemptsToday(supabase, auth.user.id);
  if (attemptsToday >= PILOT_DAILY_ATTEMPT_LIMIT) {
    throw new Error(
      `Limite de ${PILOT_DAILY_ATTEMPT_LIMIT} simulados do SDEA por dia atingido. Tente novamente amanhã.`,
    );
  }

  const { data, error } = await supabase
    .from("simulation_attempts")
    .insert({
      user_id: auth.user.id,
      phase: "pilot_interview",
      mode,
      status: "in_progress",
      current_part: "part1",
      current_item_index: 0,
      current_state: "PILOT_PART_1_INTRO",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Não foi possível iniciar o simulado.");
  }

  redirect(`/sdea/entrevista/${data.id}`);
}

// Mesmo padrão de abandonAndRestartAttempt do controlador — usada pelo botão
// "Abandonar e começar novo" quando existe uma tentativa `practice` pausada.
export async function abandonAndRestartAttempt(attemptId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  await supabase
    .from("simulation_attempts")
    .update({ status: "abandoned" })
    .eq("id", attemptId)
    .eq("user_id", auth.user.id)
    .eq("status", "in_progress");

  await startAttempt("practice");
}

// Maior texto real que passa por aqui é o feedback curto por resposta
// (max_tokens 300 ≈ 1200 caracteres no pior caso) — mesma folga da Fase 2.
const MAX_SPEECH_TEXT_LENGTH = 1500;

export async function generateSpeech(
  attemptId: string,
  text: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  if (text.length > MAX_SPEECH_TEXT_LENGTH) {
    throw new Error("Texto muito longo para narração.");
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Não autenticado.");
  await assertOwnAttemptInProgress(supabase, attemptId, auth.user.id);

  const { buffer, mimeType } = await generateSpeechAudio(text);
  return { audioBase64: buffer.toString("base64"), mimeType };
}

type ResponseWithPrompt = {
  transcript: string | null;
  response_stage: PilotResponseStage;
  pilot_prompts: {
    part: Part;
    prompt_text: string;
    atc_audio_text: string | null;
    complication_text: string | null;
    atc_followup_audio_text: string | null;
    discussion_question: string | null;
    discussion_question_2: string | null;
    agree_disagree_statement: string | null;
  } | null;
};

export async function advanceState(attemptId: string): Promise<{ finished: boolean }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Não autenticado.");

  const attempt = await assertOwnAttemptInProgress(supabase, attemptId, auth.user.id);
  const currentPart = attempt.current_part as Part;
  const currentItemIndex = attempt.current_item_index ?? 0;

  const next = computeNextPosition(currentPart, currentItemIndex);

  if (next === null) {
    const { data: responses } = await supabase
      .from("pilot_responses")
      .select(
        "transcript, response_stage, pilot_prompts(part, prompt_text, atc_audio_text, complication_text, " +
          "atc_followup_audio_text, discussion_question, discussion_question_2, agree_disagree_statement)",
      )
      .eq("simulation_attempt_id", attemptId)
      .not("transcript", "is", null);

    const transcripts = ((responses as ResponseWithPrompt[] | null) ?? [])
      .filter(
        (r): r is ResponseWithPrompt & { transcript: string; pilot_prompts: NonNullable<ResponseWithPrompt["pilot_prompts"]> } =>
          r.transcript !== null && r.pilot_prompts !== null,
      )
      .map((r) => ({
        part: r.pilot_prompts.part,
        promptText: pilotResponseContext(r.response_stage, r.pilot_prompts),
        transcript: r.transcript,
      }));

    const report = await generatePilotFinalReport(transcripts, attempt.mode as SimulationMode);

    await supabase.from("simulation_feedbacks").insert({
      simulation_attempt_id: attemptId,
      phase: "pilot_interview",
      overall_score: report.overall,
      pronunciation_score: report.pronunciation,
      structure_score: report.structure,
      vocabulary_score: report.vocabulary,
      fluency_score: report.fluency,
      comprehension_score: report.comprehension,
      interaction_score: report.interaction,
      general_feedback: report.general_feedback,
      ai_provider: "anthropic",
      model_version: MODEL_VERSION,
    });

    await supabase
      .from("simulation_attempts")
      .update({ status: "completed", finished_at: new Date().toISOString(), current_state: "INTERVIEW_FINISHED" })
      .eq("id", attemptId);

    return { finished: true };
  }

  await supabase
    .from("simulation_attempts")
    .update({ current_part: next.part, current_item_index: next.itemIndex, current_state: next.stateLabel })
    .eq("id", attemptId);

  return { finished: false };
}
