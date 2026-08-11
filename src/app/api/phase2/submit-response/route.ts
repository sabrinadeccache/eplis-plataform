import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/ai/openai";
import { generateResponseFeedback, MODEL_VERSION, type FeedbackStage } from "@/lib/ai/anthropic";
import { assertOwnAttemptInProgress } from "@/services/simulations/phase2/actions";
import type { ResponseStage } from "@/types/database";

// Envio da resposta gravada da entrevista simulada (Fase 2). Isto é uma
// route handler comum, NÃO uma Server Action — respostas mais longas (ex.: a
// história da Parte 4, sem limite de tempo no modo practice) geram um áudio
// em base64 grande o bastante pra estourar o "Maximum array nesting
// exceeded" do protocolo Flight que as Server Actions usam pra decodificar
// argumentos (um limite interno do React, separado e mais baixo que o
// `serverActions.bodySizeLimit` do next.config.ts — achado real, erro 500
// reproduzido ao enviar uma história longa). Upload binário via
// `multipart/form-data` numa rota comum não passa por esse protocolo, então
// não tem esse limite.
export async function POST(request: Request) {
  const formData = await request.formData();
  const attemptId = formData.get("attemptId");
  const promptId = formData.get("promptId");
  const stage = formData.get("stage") as ResponseStage | null;
  const repetitionCount = Number(formData.get("repetitionCount") ?? 0);
  const audio = formData.get("audio");

  if (
    typeof attemptId !== "string" ||
    typeof promptId !== "string" ||
    typeof stage !== "string" ||
    !(audio instanceof Blob)
  ) {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let attempt;
  try {
    attempt = await assertOwnAttemptInProgress(supabase, attemptId, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Tentativa inválida ou já finalizada." }, { status: 403 });
  }

  const { data: prompt } = await supabase
    .from("phase2_prompts")
    .select("prompt_text")
    .eq("id", promptId)
    .single();
  if (!prompt) {
    return NextResponse.json({ error: "Prompt inválido." }, { status: 400 });
  }

  const mimeType = audio.type || "audio/webm";
  const buffer = Buffer.from(await audio.arrayBuffer());
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  const path = `${attemptId}/${promptId}-${stage}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("phase2-recordings")
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: `Falha ao enviar o áudio: ${uploadError.message}` }, { status: 500 });
  }

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
  if (insertError || !inserted) {
    return NextResponse.json({ error: "Não foi possível registrar a resposta." }, { status: 500 });
  }

  const transcript = await transcribeAudio(buffer, `audio.${ext}`);
  await supabase
    .from("phase2_responses")
    .update({ transcript, processing_status: "analyzing" })
    .eq("id", inserted.id);

  // Modo `official` não dá nenhum feedback durante a entrevista (só o relatório
  // final) — pular a chamada de IA aqui evita custo/latência de algo que nunca
  // seria mostrado ao candidato. `ai_feedback` fica null, como já documentado em
  // docs/database-schema.md ("preenchido em tempo real no practice, só ao final
  // no official").
  if (attempt.mode === "official") {
    await supabase
      .from("phase2_responses")
      .update({ processing_status: "done", finished_at: new Date().toISOString() })
      .eq("id", inserted.id);

    return NextResponse.json({ transcript, feedback: null });
  }

  const FEEDBACK_STAGES: FeedbackStage[] = ["situation_check", "suggestion", "image_description", "story_telling"];
  const feedback = await generateResponseFeedback(
    prompt.prompt_text,
    transcript,
    FEEDBACK_STAGES.includes(stage as FeedbackStage) ? (stage as FeedbackStage) : undefined,
  );
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

  return NextResponse.json({ transcript, feedback });
}
