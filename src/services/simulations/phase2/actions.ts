"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateSpeechAudio } from "@/lib/ai/openai";
import { generateFinalReport, MODEL_VERSION } from "@/lib/ai/anthropic";
import { computeNextPosition } from "@/services/simulations/phase2/state-machine";
import type { Part, SimulationMode } from "@/types/database";

export async function startAttempt(mode: SimulationMode) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data, error } = await supabase
    .from("simulation_attempts")
    .insert({
      user_id: auth.user.id,
      phase: "phase2",
      mode,
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

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Exportado pra ser reaproveitado pela route handler de submitResponse
// (src/app/api/phase2/submit-response/route.ts) — o envio do áudio precisou
// sair de uma Server Action pra uma rota comum (ver comentário lá) mas a
// checagem de posse/estado da tentativa continua sendo a mesma.
export async function assertOwnAttemptInProgress(
  supabase: SupabaseServerClient,
  attemptId: string,
  userId: string,
) {
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status, mode, current_part, current_item_index")
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
      .select("transcript, response_stage, phase2_prompts(part, prompt_text)")
      .eq("simulation_attempt_id", attemptId)
      .not("transcript", "is", null);

    type ResponseWithPrompt = {
      transcript: string | null;
      response_stage: string;
      phase2_prompts: { part: Part; prompt_text: string } | null;
    };

    const transcripts = ((responses as ResponseWithPrompt[] | null) ?? [])
      .filter((r): r is ResponseWithPrompt & { transcript: string; phase2_prompts: { part: Part; prompt_text: string } } =>
        r.transcript !== null && r.phase2_prompts !== null,
      )
      .map((r) => ({
        part: r.phase2_prompts.part,
        // Na Parte 4, o prompt_text salvo é sempre o texto de descrição da
        // imagem, reaproveitado pros dois estágios do item (descrição e
        // história) — pra história, isso confundia o relatório final, que
        // passou a cobrar detalhes visuais concretos numa resposta que era
        // pra ser uma narrativa livre. Mesmo achado já corrigido no feedback
        // curto por resposta (ver generateResponseFeedback).
        promptText:
          r.response_stage === "story_telling"
            ? "Tell a short story related to the image you were shown."
            : r.phase2_prompts.prompt_text,
        transcript: r.transcript,
      }));

    const report = await generateFinalReport(transcripts, attempt.mode as SimulationMode);

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
