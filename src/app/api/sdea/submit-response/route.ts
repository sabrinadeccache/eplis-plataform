import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize, AuthError } from "@/lib/auth/authorize";
import { transcribeAudio } from "@/lib/ai/openai";
import { generatePilotResponseFeedback, MODEL_VERSION, type PilotFeedbackStage } from "@/lib/ai/pilot-track";
import { pilotResponseContext } from "@/services/simulations/pilot/context";
import { assertOwnAttemptInProgress } from "@/services/simulations/pilot/actions";
import { getSequenceForAttempt, type PilotItemSequence } from "@/services/simulations/pilot/queries";
import { responseStagesForPilotItem } from "@/services/simulations/pilot/response-stages";
import { sdeaAircraftType } from "@/lib/auth/roles";
import { validateAudioContainer, validateDecodedAudio, MAX_REQUEST_BODY_BYTES } from "@/lib/audio/validate";
import {
  assertCurrentPrompt,
  assertContentLengthWithinLimit,
  reserveResponseSlot,
  ItemGuardError,
} from "@/lib/simulations/item-guard";
import { assertSubmissionRate } from "@/lib/simulations/rate-limit";
import { buildRecordingPath } from "@/lib/simulations/recording-access";
import { recordingExpiresAt } from "@/lib/simulations/retention";
import { getConsentStatus } from "@/lib/simulations/consent";
import type { Part, PilotResponseStage, SimulationMode } from "@/types/database";

// Envio da resposta gravada da trilha do piloto/SDEA — mesmo motivo da rota
// equivalente da Fase 2 (route handler comum, não Server Action, por causa do
// limite "Maximum array nesting exceeded" do protocolo Flight com áudio longo
// em base64; ver src/app/api/phase2/submit-response/route.ts) e mesmo guard
// de item/idempotência/ordem do Milestone 2
// (src/lib/simulations/item-guard.ts, revisado em 2026-09-11). O decode
// real do áudio só roda DEPOIS do rate limit e da reserva de slot — ver
// comentário em src/lib/audio/validate.ts e na rota equivalente da Fase 2.
export async function POST(request: Request) {
  try {
    assertContentLengthWithinLimit(request, MAX_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof ItemGuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const supabase = await createClient();
  let userId: string;
  let aircraftType: ReturnType<typeof sdeaAircraftType>;
  try {
    const { user } = await authorize(supabase, { track: "pilot" });
    userId = user.id;
    aircraftType = sdeaAircraftType(user.operational_profile);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  // Milestone 3.3: ver comentário equivalente na rota da Fase 2 — o gate na
  // tela é UX, esta é a checagem que de fato impede a gravação.
  const consent = await getConsentStatus(supabase, userId);
  if (!consent.accepted) {
    return NextResponse.json({ error: "Consentimento de gravação ainda não registrado." }, { status: 403 });
  }

  const formData = await request.formData();
  const attemptId = formData.get("attemptId");
  const promptId = formData.get("promptId");
  const stage = formData.get("stage") as PilotResponseStage | null;
  const slotRaw = formData.get("slot");
  const repetitionCount = Number(formData.get("repetitionCount") ?? 0);
  const audio = formData.get("audio");

  if (
    typeof attemptId !== "string" ||
    typeof promptId !== "string" ||
    typeof stage !== "string" ||
    typeof slotRaw !== "string" ||
    !(audio instanceof Blob)
  ) {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const slot = Number(slotRaw);

  let attempt;
  try {
    attempt = await assertOwnAttemptInProgress(supabase, attemptId, userId);
  } catch {
    return NextResponse.json({ error: "Tentativa inválida ou já finalizada." }, { status: 403 });
  }

  // Checagem barata (tamanho/MIME/assinatura) — o decode real vem depois da
  // reserva de slot, mais abaixo.
  const mimeType = audio.type || "audio/webm";
  const buffer = Buffer.from(await audio.arrayBuffer());
  const containerCheck = validateAudioContainer(buffer, mimeType);
  if (!containerCheck.ok) {
    return NextResponse.json({ error: containerCheck.reason }, { status: 422 });
  }

  // Escrita em pilot_responses só via service_role. Autorização + posse acima.
  const admin = createAdminClient();

  try {
    await assertSubmissionRate(supabase, admin, "pilot_responses", attemptId, userId);

    const currentPart = attempt.current_part as Part;
    const currentItemIndex = attempt.current_item_index ?? 0;
    const sequence = await getSequenceForAttempt(
      attemptId,
      aircraftType,
      attempt.item_sequence as PilotItemSequence | null,
    );
    const expectedPrompt = sequence[currentPart]?.[currentItemIndex];
    assertCurrentPrompt(expectedPrompt?.id, promptId);

    const reservation = await reserveResponseSlot({
      supabase,
      admin,
      table: "pilot_responses",
      attemptId,
      promptId,
      stage,
      slot,
      expectedStages: responseStagesForPilotItem(currentPart, currentItemIndex),
    });

    if (reservation.kind === "conflict") {
      return NextResponse.json(
        { error: "Esta resposta já está sendo processada." },
        { status: 409 },
      );
    }

    if (reservation.kind === "replay") {
      return NextResponse.json({
        transcript: reservation.response.transcript,
        feedback: reservation.response.ai_feedback,
      });
    }

    const responseId = reservation.responseId;

    // Só agora, com o slot já reservado (rate limit e corrida já passaram),
    // decodifica de verdade. Arquivo inválido marca ESTA linha como erro —
    // conta pro teto de retry do slot, não é mais uma tentativa "de graça".
    const validation = await validateDecodedAudio(buffer, containerCheck.container);
    if (!validation.ok) {
      await admin.from("pilot_responses").update({ processing_status: "error" }).eq("id", responseId);
      // 503 quando o problema é NOSSO (o validador não rodou) — só 422
      // quando o arquivo do candidato é que não presta. Sem essa distinção,
      // uma falha de infraestrutura aparecia pro candidato como "seu áudio
      // está corrompido" (achado da homologação em produção).
      const status = validation.kind === "unavailable" ? 503 : 422;
      return NextResponse.json({ error: validation.reason }, { status });
    }

    const ext = validation.container === "mp4" ? "mp4" : "webm";
    // Caminho privado, com o dono no prefixo e sufixo aleatório — ver
    // buildRecordingPath em src/lib/simulations/recording-access.ts (M3.1).
    const path = buildRecordingPath({ userId, attemptId, promptId, stage, slot, ext });

    const { error: uploadError } = await supabase.storage
      .from("pilot-recordings")
      .upload(path, buffer, { contentType: mimeType, upsert: true });
    if (uploadError) {
      await admin
        .from("pilot_responses")
        .update({ processing_status: "error" })
        .eq("id", responseId);
      return NextResponse.json({ error: `Falha ao enviar o áudio: ${uploadError.message}` }, { status: 500 });
    }

    // Bucket privado (M3.1): guarda o CAMINHO do objeto, não uma URL
    // pública. O acesso é por URL assinada de vida curta, gerada só depois
    // de confirmar autorização — ver createRecordingSignedUrl.
    await admin
      .from("pilot_responses")
      .update({
        audio_path: path,
        repetition_count: repetitionCount,
        // Prazo de retenção da GRAVAÇÃO (M3.2): practice 30 dias, official
        // 180. Gravado explicitamente pra a retenção ser auditável — ver
        // src/lib/simulations/retention.ts.
        expires_at: recordingExpiresAt(attempt.mode as SimulationMode),
      })
      .eq("id", responseId);

    let transcript: string;
    try {
      transcript = await transcribeAudio(buffer, `audio.${ext}`);
    } catch {
      await admin.from("pilot_responses").update({ processing_status: "error" }).eq("id", responseId);
      return NextResponse.json({ error: "Não foi possível transcrever o áudio." }, { status: 502 });
    }
    await admin
      .from("pilot_responses")
      .update({ transcript, processing_status: "analyzing" })
      .eq("id", responseId);

    const { data: prompt } = await supabase
      .from("pilot_prompts")
      .select(
        "prompt_text, atc_audio_text, complication_text, atc_followup_audio_text, discussion_question, discussion_question_2, agree_disagree_statement",
      )
      .eq("id", promptId)
      .single();

    // Modo `official` não dá nenhum feedback durante o simulado (só o
    // relatório final) — mesmo comportamento/motivo já documentado na Fase 2.
    if (attempt.mode === "official") {
      await admin
        .from("pilot_responses")
        .update({ processing_status: "done", finished_at: new Date().toISOString() })
        .eq("id", responseId);

      return NextResponse.json({ transcript, feedback: null });
    }

    const NO_FEEDBACK_STAGES: PilotResponseStage[] = ["main"];
    const context = prompt ? pilotResponseContext(stage, prompt) : "";
    const feedback = await generatePilotResponseFeedback(
      context,
      transcript,
      NO_FEEDBACK_STAGES.includes(stage) ? undefined : (stage as PilotFeedbackStage),
    );
    await admin
      .from("pilot_responses")
      .update({
        ai_feedback: feedback,
        ai_provider: "anthropic",
        model_version: MODEL_VERSION,
        processing_status: "done",
        finished_at: new Date().toISOString(),
      })
      .eq("id", responseId);

    return NextResponse.json({ transcript, feedback });
  } catch (error) {
    if (error instanceof ItemGuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
