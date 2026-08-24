import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/ai/openai";
import { generatePilotResponseFeedback, MODEL_VERSION, type PilotFeedbackStage } from "@/lib/ai/pilot-track";
import { pilotResponseContext } from "@/services/simulations/pilot/context";
import { assertOwnAttemptInProgress } from "@/services/simulations/pilot/actions";
import type { PilotResponseStage } from "@/types/database";

// Envio da resposta gravada da trilha do piloto/SDEA — mesmo motivo da rota
// equivalente da Fase 2 (route handler comum, não Server Action, por causa do
// limite "Maximum array nesting exceeded" do protocolo Flight com áudio longo
// em base64; ver src/app/api/phase2/submit-response/route.ts).
export async function POST(request: Request) {
  const formData = await request.formData();
  const attemptId = formData.get("attemptId");
  const promptId = formData.get("promptId");
  const stage = formData.get("stage") as PilotResponseStage | null;
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
    .from("pilot_prompts")
    .select(
      "prompt_text, atc_audio_text, complication_text, atc_followup_audio_text, discussion_question, discussion_question_2, agree_disagree_statement",
    )
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
    .from("pilot-recordings")
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: `Falha ao enviar o áudio: ${uploadError.message}` }, { status: 500 });
  }

  const { data: publicUrlData } = supabase.storage.from("pilot-recordings").getPublicUrl(path);
  const audioUrl = publicUrlData.publicUrl;

  const { data: inserted, error: insertError } = await supabase
    .from("pilot_responses")
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
    .from("pilot_responses")
    .update({ transcript, processing_status: "analyzing" })
    .eq("id", inserted.id);

  // Modo `official` não dá nenhum feedback durante o simulado (só o relatório
  // final) — mesmo comportamento/motivo já documentado na Fase 2.
  if (attempt.mode === "official") {
    await supabase
      .from("pilot_responses")
      .update({ processing_status: "done", finished_at: new Date().toISOString() })
      .eq("id", inserted.id);

    return NextResponse.json({ transcript, feedback: null });
  }

  const NO_FEEDBACK_STAGES: PilotResponseStage[] = ["main"];
  const context = pilotResponseContext(stage, prompt);
  const feedback = await generatePilotResponseFeedback(
    context,
    transcript,
    NO_FEEDBACK_STAGES.includes(stage) ? undefined : (stage as PilotFeedbackStage),
  );
  await supabase
    .from("pilot_responses")
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
