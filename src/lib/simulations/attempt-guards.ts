// Módulo compartilhado (não "use server") de checagens comuns às trilhas de
// simulação (Fase 2 do controlador e SDEA do piloto) — um arquivo "use server"
// só pode exportar funções async, e `countAttemptsToday` recebe o client do
// Supabase como argumento (não serializável), então não pode viver junto com
// as Server Actions. Extraído de `services/simulations/phase2/actions.ts` e
// `limits.ts`, generalizado por `phase` pra ser reaproveitado pela trilha do
// piloto sem duplicar a lógica.
import { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Phase } from "@/types/database";

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Rechecagem de UX, mantida para recusar cedo uma conta que foi bloqueada
// durante o decode. Ela NÃO é a garantia contra corrida de exclusão (um
// SELECT seguido de escrita é TOCTOU). A garantia M3 está nas RPCs/tickets e
// triggers transacionais de privacy-barrier.ts + migration 070000: upload
// coordena com exclusão e conteúdo tardio é recusado inclusive via service_role.
export async function assertAccountStillActive(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<void> {
  const { data, error } = await admin.from("users").select("status").eq("id", userId).maybeSingle();
  if (error || !data || data.status !== "active") {
    throw new Error("Conta não está mais ativa.");
  }
}

export async function assertOwnAttemptInProgress(
  supabase: SupabaseServerClient,
  attemptId: string,
  userId: string,
  expectedPhase: Phase,
) {
  const { data: attempt } = await supabase
    .from("simulation_attempts")
    .select("id, user_id, phase, status, mode, current_part, current_item_index, item_sequence")
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
