import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize, AuthError } from "@/lib/auth/authorize";
import { assertCurrentPrompt, assertValidSlot, ItemGuardError } from "@/lib/simulations/item-guard";
import { assertOwnAttemptInProgress as assertControllerAttempt } from "@/services/simulations/phase2/actions";
import { assertOwnAttemptInProgress as assertPilotAttempt } from "@/services/simulations/pilot/actions";
import { getSequenceForAttempt as getControllerSequence, type Phase2ItemSequence } from "@/services/simulations/phase2/queries";
import { getSequenceForAttempt as getPilotSequence, type PilotItemSequence } from "@/services/simulations/pilot/queries";
import { responseStagesForPhase2Item } from "@/services/simulations/phase2/response-stages";
import { responseStagesForPilotItem } from "@/services/simulations/pilot/response-stages";
import { sdeaAircraftType } from "@/lib/auth/roles";
import { getConsentStatus } from "@/lib/simulations/consent";
import type { Part } from "@/types/database";

type Track = "phase2" | "pilot_interview";
type Event = "question_started" | "question_finished" | "repeat" | "recording_started" | "recording_finished";
type Body = { track?: Track; event?: Event; attemptId?: string; promptId?: string; stage?: string; slot?: number; clientSessionToken?: string };

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 8 * 1024) {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 413 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const { track, event, attemptId, promptId, stage, slot, clientSessionToken } = body;
  if (!track || !event || !attemptId || !promptId || !stage || !Number.isInteger(slot) || !clientSessionToken) {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const itemSlot = slot as number;

  const supabase = await createClient();
  try {
    const { user } = await authorize(supabase, { track: track === "phase2" ? "controller" : "pilot" });
    const attempt = track === "phase2"
      ? await assertControllerAttempt(supabase, attemptId, user.id)
      : await assertPilotAttempt(supabase, attemptId, user.id);
    if (attempt.mode !== "official") {
      return NextResponse.json({ error: "Relógio oficial indisponível neste modo." }, { status: 403 });
    }
    const consent = await getConsentStatus(supabase, user.id);
    if (!consent.accepted) {
      return NextResponse.json({ error: "Consentimento de gravação ainda não registrado." }, { status: 403 });
    }

    const part = attempt.current_part as Part;
    const itemIndex = attempt.current_item_index ?? 0;
    const sequence = track === "phase2"
      ? await getControllerSequence(attemptId, user.operational_profile, attempt.item_sequence as Phase2ItemSequence | null)
      : await getPilotSequence(attemptId, sdeaAircraftType(user.operational_profile), attempt.item_sequence as PilotItemSequence | null);
    const prompt = sequence[part]?.[itemIndex];
    assertCurrentPrompt(prompt?.id, promptId);
    const expectedStages = track === "phase2"
      ? responseStagesForPhase2Item(part)
      : responseStagesForPilotItem(part, itemIndex);
    assertValidSlot(itemSlot, stage, expectedStages);

    const admin = createAdminClient();
    const identity = { simulation_attempt_id: attemptId, prompt_id: promptId, item_slot: itemSlot };
    const { error: upsertError } = await admin.from("official_response_windows").upsert({
      ...identity,
      track,
      response_stage: stage,
      expected_duration_seconds: Math.max(1, Math.min(480, prompt.expectedDurationSeconds)),
    }, { onConflict: "simulation_attempt_id,prompt_id,item_slot", ignoreDuplicates: true });
    if (upsertError) throw new Error("official window insert failed");

    const { data: existing, error: readError } = await admin
      .from("official_response_windows")
      .select("id, question_started_at, recording_started_at, recording_finished_at, client_session_token, repetition_count, expected_duration_seconds")
      .match(identity)
      .single();
    if (readError || !existing) throw new Error("official window unavailable");

    if (event === "recording_started") {
      if (existing.recording_started_at) {
        if (existing.client_session_token === clientSessionToken) {
          return NextResponse.json({
            recording_started_at: existing.recording_started_at,
            expected_duration_seconds: existing.expected_duration_seconds,
          });
        }
        const responseTable = track === "phase2" ? "phase2_responses" : "pilot_responses";
        const { data: recoverable } = await admin.from(responseTable)
          .select("audio_path")
          .eq("simulation_attempt_id", attemptId)
          .eq("prompt_id", promptId)
          .eq("item_slot", itemSlot)
          .maybeSingle();
        return NextResponse.json({
          error: recoverable?.audio_path
            ? "Esta gravação já foi enviada. Retome o processamento sem gravar novamente."
            : "Esta gravação oficial já foi iniciada e não pode ser reiniciada.",
          canResume: Boolean(recoverable?.audio_path),
        }, { status: 409 });
      }
      const now = new Date().toISOString();
      const { data: started, error } = await admin.from("official_response_windows")
        .update({ recording_started_at: now, client_session_token: clientSessionToken })
        .eq("id", existing.id)
        .is("recording_started_at", null)
        .select("recording_started_at, expected_duration_seconds")
        .maybeSingle();
      if (error) throw new Error("official recording start failed");
      if (!started) return NextResponse.json({ error: "Esta gravação oficial já foi iniciada." }, { status: 409 });
      return NextResponse.json(started);
    }

    if (event === "recording_finished") {
      if (!existing.recording_started_at || existing.client_session_token !== clientSessionToken) {
        return NextResponse.json({ error: "Janela de gravação oficial inválida." }, { status: 409 });
      }
      if (existing.recording_finished_at) {
        return NextResponse.json({ recording_finished_at: existing.recording_finished_at });
      }
      const finishedAt = new Date().toISOString();
      const { error } = await admin.from("official_response_windows").update({ recording_finished_at: finishedAt }).eq("id", existing.id);
      if (error) throw new Error("official recording finish failed");
      return NextResponse.json({ recording_finished_at: finishedAt });
    }

    if (event === "repeat") {
      if (existing.recording_started_at) {
        return NextResponse.json({ error: "A pergunta não pode ser repetida depois do início da gravação." }, { status: 409 });
      }
      const { data: next, error } = await admin.rpc("increment_official_repetition", { p_window_id: existing.id });
      if (error || next == null) return NextResponse.json({ error: "A janela de repetição foi encerrada." }, { status: 409 });
      return NextResponse.json({ repetition_count: next });
    }

    const value = new Date().toISOString();
    if (event === "question_started") {
      return NextResponse.json({ question_started_at: existing.question_started_at, repetition_count: existing.repetition_count });
    }
    const { error } = await admin.from("official_response_windows").update({ question_finished_at: value }).eq("id", existing.id).is("question_finished_at", null);
    if (error) throw new Error("official question finish failed");
    return NextResponse.json({ question_finished_at: value, repetition_count: existing.repetition_count });
  } catch (error) {
    if (error instanceof AuthError || error instanceof ItemGuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Não foi possível registrar o relógio oficial." }, { status: 500 });
  }
}
