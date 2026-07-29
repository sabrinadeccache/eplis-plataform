"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio, generateSpeechAudio } from "@/lib/ai/openai";
import { generateResponseFeedback, generateFinalReport, MODEL_VERSION } from "@/lib/ai/anthropic";
import { computeNextPosition } from "@/services/simulations/phase2/state-machine";
import type { Part, ResponseStage } from "@/types/database";

export async function startAttempt() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data, error } = await supabase
    .from("simulation_attempts")
    .insert({
      user_id: auth.user.id,
      phase: "phase2",
      mode: "practice",
      status: "in_progress",
      current_part: "part1",
      current_item_index: 0,
      current_state: "PART_1_INTRO",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Não foi possível iniciar a entrevista.");
  }

  redirect(`/fase2/entrevista/${data.id}`);
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function assertOwnAttemptInProgress(
  supabase: SupabaseServerClient,
  attemptId: string,
  userId: string,
) {
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status, current_part, current_item_index")
    .eq("id", attemptId)
    .single();

  if (
    !attempt ||
    attempt.user_id !== userId ||
    attempt.phase !== "phase2" ||
    attempt.status !== "in_progress"
  ) {
    throw new Error("Tentativa inválida ou já finalizada.");
  }

  return attempt;
}

export async function generateSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }> {
  const { buffer, mimeType } = await generateSpeechAudio(text);
  return { audioBase64: buffer.toString("base64"), mimeType };
}

export async function submitResponse(
  attemptId: string,
  promptId: string,
  stage: ResponseStage,
  audioBase64: string,
  mimeType: string,
  repetitionCount = 0,
): Promise<{ transcript: string; feedback: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Não autenticado.");

  await assertOwnAttemptInProgress(supabase, attemptId, auth.user.id);

  const { data: prompt } = await supabase
    .from("phase2_prompts")
    .select("prompt_text")
    .eq("id", promptId)
    .single();
  if (!prompt) throw new Error("Prompt inválido.");

  const buffer = Buffer.from(audioBase64, "base64");
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  const path = `${attemptId}/${promptId}-${stage}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("phase2-recordings")
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (uploadError) throw new Error(`Falha ao enviar o áudio: ${uploadError.message}`);

  const { data: publicUrlData } = supabase.storage.from("phase2-recordings").getPublicUrl(path);
  const audioUrl = publicUrlData.publicUrl;

  const { data: inserted, error: insertError } = await supabase
    .from("phase2_responses")
    .insert({
      simulation_attempt_id: attemptId,
      prompt_id: promptId,
      response_stage: stage,
      audio_url: audioUrl,
      processing_status: "transcribing",
      repetition_count: repetitionCount,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError || !inserted) throw new Error("Não foi possível registrar a resposta.");

  const transcript = await transcribeAudio(buffer, `audio.${ext}`);
  await supabase
    .from("phase2_responses")
    .update({ transcript, processing_status: "analyzing" })
    .eq("id", inserted.id);

  const feedback = await generateResponseFeedback(prompt.prompt_text, transcript);
  await supabase
    .from("phase2_responses")
    .update({
      ai_feedback: feedback,
      ai_provider: "anthropic",
      model_version: MODEL_VERSION,
      processing_status: "done",
      finished_at: new Date().toISOString(),
    })
    .eq("id", inserted.id);

  return { transcript, feedback };
}

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
      .from("phase2_responses")
      .select("transcript, phase2_prompts(part, prompt_text)")
      .eq("simulation_attempt_id", attemptId)
      .not("transcript", "is", null);

    type ResponseWithPrompt = {
      transcript: string | null;
      phase2_prompts: { part: Part; prompt_text: string } | null;
    };

    const transcripts = ((responses as ResponseWithPrompt[] | null) ?? [])
      .filter((r): r is ResponseWithPrompt & { transcript: string; phase2_prompts: { part: Part; prompt_text: string } } =>
        r.transcript !== null && r.phase2_prompts !== null,
      )
      .map((r) => ({ part: r.phase2_prompts.part, promptText: r.phase2_prompts.prompt_text, transcript: r.transcript }));

    const report = await generateFinalReport(transcripts);

    await supabase.from("simulation_feedbacks").insert({
      simulation_attempt_id: attemptId,
      phase: "phase2",
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
