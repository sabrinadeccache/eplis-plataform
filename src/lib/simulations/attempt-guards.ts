// Módulo compartilhado (não "use server") de checagens comuns às trilhas de
// simulação (Fase 2 do controlador e SDEA do piloto) — um arquivo "use server"
// só pode exportar funções async, e `countAttemptsToday` recebe o client do
// Supabase como argumento (não serializável), então não pode viver junto com
// as Server Actions. Extraído de `services/simulations/phase2/actions.ts` e
// `limits.ts`, generalizado por `phase` pra ser reaproveitado pela trilha do
// piloto sem duplicar a lógica.
import { createClient } from "@/lib/supabase/server";
import type { Phase } from "@/types/database";

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function assertOwnAttemptInProgress(
  supabase: SupabaseServerClient,
  attemptId: string,
  userId: string,
  expectedPhase: Phase,
) {
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status, mode, current_part, current_item_index")
    .eq("id", attemptId)
    .single();

  if (
    !attempt ||
    attempt.user_id !== userId ||
    attempt.phase !== expectedPhase ||
    attempt.status !== "in_progress"
  ) {
    throw new Error("Tentativa inválida ou já finalizada.");
  }

  return attempt;
}

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export async function countAttemptsToday(
  supabase: SupabaseServerClient,
  userId: string,
  phase: Phase,
): Promise<number> {
  const { count } = await supabase
    .from("simulation_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("phase", phase)
    .gte("started_at", startOfTodayIso());
  return count ?? 0;
}
