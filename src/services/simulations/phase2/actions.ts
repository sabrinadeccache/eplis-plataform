"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateSpeechAudio } from "@/lib/ai/openai";
import { generateFinalReport, MODEL_VERSION } from "@/lib/ai/anthropic";
import { computeNextPosition } from "@/services/simulations/phase2/state-machine";
import { DAILY_ATTEMPT_LIMIT, countAttemptsToday } from "@/services/simulations/phase2/limits";
import {
  assertOwnAttemptInProgress as assertOwnAttemptInProgressShared,
  type SupabaseServerClient,
} from "@/lib/simulations/attempt-guards";
import type { Part, SimulationMode } from "@/types/database";

export async function startAttempt(mode: SimulationMode) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const attemptsToday = await countAttemptsToday(supabase, auth.user.id);
  if (attemptsToday >= DAILY_ATTEMPT_LIMIT) {
    throw new Error(
      `Limite de ${DAILY_ATTEMPT_LIMIT} simulados da Fase 2 por dia atingido. Tente novamente amanhã.`,
    );
  }

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

// Usada pela tela `/fase2` no botão "Abandonar e começar novo", pra quem tem
// uma tentativa `practice` pausada mas prefere recomeçar do zero em vez de
// continuar — marca a antiga como `abandoned` (sem isso ficaria `in_progress`
// pra sempre, nunca aparecendo em Desempenho, que só lista `completed`) e já
// cria + redireciona pra uma nova, igual `startAttempt`.
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

// Exportado pra ser reaproveitado pela route handler de submitResponse
// (src/app/api/phase2/submit-response/route.ts) — o envio do áudio precisou
// sair de uma Server Action pra uma rota comum (ver comentário lá) mas a
// checagem de posse/estado da tentativa continua sendo a mesma. A checagem em
// si vive em src/lib/simulations/attempt-guards.ts (compartilhada com a
// trilha do piloto), generalizada por `phase` — aqui só fixamos "phase2".
export async function assertOwnAttemptInProgress(
  supabase: SupabaseServerClient,
  attemptId: string,
  userId: string,
) {
  return assertOwnAttemptInProgressShared(supabase, attemptId, userId, "phase2");
}

// Maior texto real que passa por aqui é o feedback curto por resposta
// (`generateResponseFeedback`, max_tokens 300 ≈ 1200 caracteres no pior
// caso) — a folga cobre isso com margem sem deixar a rota aceitar texto
// arbitrário de tamanho ilimitado.
const MAX_SPEECH_TEXT_LENGTH = 1500;

// Exige o attemptId (antes a Server Action aceitava qualquer string,
// autenticada ou não, sem vínculo com uma entrevista real) — sem isso um
// usuário autenticado podia chamar generateSpeech direto com texto arbitrário
// repetidamente e gerar custo de TTS sem nenhuma relação com o fluxo real da
// entrevista. Reaproveita a mesma checagem de posse/estado de
// assertOwnAttemptInProgress usada pelo resto da Fase 2.
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
      .select("transcript, response_stage, repetition_count, phase2_prompts(part, prompt_text)")
      .eq("simulation_attempt_id", attemptId)
      .not("transcript", "is", null);

    type ResponseWithPrompt = {
      transcript: string | null;
      response_stage: string;
      repetition_count: number | null;
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
        repetitionCount: r.repetition_count ?? 0,
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
