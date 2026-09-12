import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize, AuthError } from "@/lib/auth/authorize";
import { transcribeAudio } from "@/lib/ai/openai";
import { generateResponseFeedback, MODEL_VERSION, type FeedbackStage } from "@/lib/ai/anthropic";
import { assertOwnAttemptInProgress } from "@/services/simulations/phase2/actions";
import { getSequenceForAttempt, type Phase2ItemSequence } from "@/services/simulations/phase2/queries";
import { responseStagesForPhase2Item } from "@/services/simulations/phase2/response-stages";
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
import type { Part, ResponseStage, SimulationMode } from "@/types/database";

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
//
// Milestone 2 do plano de correção (docs/project-status.md): antes de
// aceitar o áudio, valida o arquivo e confirma que o item/estágio recebidos
// são de fato o item corrente da tentativa (nunca confia em `promptId`/
// `stage`/`slot` do formulário como fonte final) — e garante, com uma
// reserva atômica no banco, que replay/corrida não duplica upload nem
// chamada de IA. Ver src/lib/simulations/item-guard.ts.
//
// **Ordem corrigida na revisão (2026-09-11):** `Content-Length` é checado
// ANTES de tocar no corpo, e `authorize()` roda ANTES de `request.formData()`
// — a versão anterior materializava o multipart inteiro em memória antes de
// checar sessão ou tamanho, então um chamador não-autenticado ainda forçava
// o parsing do corpo.
//
// **Ordem corrigida de novo na revisão (4ª rodada):** o decode real do
// áudio (`validateDecodedAudio`, roda o `ffmpeg`) só acontece DEPOIS do
// rate limit e da reserva atômica do slot — antes, rodava logo depois do
// parse do formulário, e requisições concorrentes disparavam processos de
// decodificação livremente, sem nenhum limite; um arquivo inválido também
// nunca chegava a criar/tocar uma linha de resposta, então não contava pro
// teto de retry (`MAX_RETRIES_PER_SLOT`) — só a autenticação limitava
// tentativas caras repetidas. Ver comentário em src/lib/audio/validate.ts.
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
  let operationalProfile: Parameters<typeof getSequenceForAttempt>[1];
  try {
    const { user } = await authorize(supabase, { track: "controller" });
    userId = user.id;
    operationalProfile = user.operational_profile;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  // Milestone 3.3: o gate na tela da entrevista é UX (bloqueia antes de
  // mostrar a IHM) — esta é a checagem que de fato impede a gravação, igual
  // ao proxy não substituir authorize() (M1): ninguém grava sem
  // consentimento registrado, mesmo chamando a rota direto.
  const consent = await getConsentStatus(supabase, userId);
  if (!consent.accepted) {
    return NextResponse.json({ error: "Consentimento de gravação ainda não registrado." }, { status: 403 });
  }

  const formData = await request.formData();
  const attemptId = formData.get("attemptId");
  const promptId = formData.get("promptId");
  const stage = formData.get("stage") as ResponseStage | null;
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

  // Checagem BARATA do arquivo (tamanho, MIME, assinatura) ANTES de
  // qualquer I/O (storage/banco/IA) — nunca decodifica nada ainda. O decode
  // real (`validateDecodedAudio`) só roda depois da reserva de slot, mais
  // abaixo — ver comentário no topo do arquivo.
  const mimeType = audio.type || "audio/webm";
  const buffer = Buffer.from(await audio.arrayBuffer());
  const containerCheck = validateAudioContainer(buffer, mimeType);
  if (!containerCheck.ok) {
    return NextResponse.json({ error: containerCheck.reason }, { status: 422 });
  }

  // Escrita em phase2_responses só via service_role (o role `authenticated`
  // está bloqueado por trigger/RLS). Autorização + posse já checadas acima.
  const admin = createAdminClient();

  try {
    await assertSubmissionRate(supabase, admin, "phase2_responses", attemptId, userId);

    const currentPart = attempt.current_part as Part;
    const currentItemIndex = attempt.current_item_index ?? 0;
    const sequence = await getSequenceForAttempt(
      attemptId,
      operationalProfile,
      attempt.item_sequence as Phase2ItemSequence | null,
    );
    const expectedPrompt = sequence[currentPart]?.[currentItemIndex];
    assertCurrentPrompt(expectedPrompt?.id, promptId);

    const reservation = await reserveResponseSlot({
      supabase,
      admin,
      table: "phase2_responses",
      attemptId,
      promptId,
      stage,
      slot,
      expectedStages: responseStagesForPhase2Item(currentPart),
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
      await admin.from("phase2_responses").update({ processing_status: "error" }).eq("id", responseId);
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
      .from("phase2-recordings")
      .upload(path, buffer, { contentType: mimeType, upsert: true });
    if (uploadError) {
      await admin
        .from("phase2_responses")
        .update({ processing_status: "error" })
        .eq("id", responseId);
      return NextResponse.json({ error: `Falha ao enviar o áudio: ${uploadError.message}` }, { status: 500 });
    }

    // Bucket privado (M3.1): guarda o CAMINHO do objeto, não uma URL
    // pública. O acesso é por URL assinada de vida curta, gerada só depois
    // de confirmar autorização — ver createRecordingSignedUrl.
    await admin
      .from("phase2_responses")
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
      await admin.from("phase2_responses").update({ processing_status: "error" }).eq("id", responseId);
      return NextResponse.json({ error: "Não foi possível transcrever o áudio." }, { status: 502 });
    }
    await admin
      .from("phase2_responses")
      .update({ transcript, processing_status: "analyzing" })
      .eq("id", responseId);

    const { data: prompt } = await supabase
      .from("phase2_prompts")
      .select("prompt_text")
      .eq("id", promptId)
      .single();

    // Modo `official` não dá nenhum feedback durante a entrevista (só o
    // relatório final) — pular a chamada de IA aqui evita custo/latência de
    // algo que nunca seria mostrado ao candidato. `ai_feedback` fica null,
    // como já documentado em docs/database-schema.md.
    if (attempt.mode === "official") {
      await admin
        .from("phase2_responses")
        .update({ processing_status: "done", finished_at: new Date().toISOString() })
        .eq("id", responseId);

      return NextResponse.json({ transcript, feedback: null });
    }

    const FEEDBACK_STAGES: FeedbackStage[] = ["situation_check", "suggestion", "image_description", "story_telling"];
    const feedback = await generateResponseFeedback(
      prompt?.prompt_text ?? "",
      transcript,
      FEEDBACK_STAGES.includes(stage as FeedbackStage) ? (stage as FeedbackStage) : undefined,
    );
    await admin
      .from("phase2_responses")
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
