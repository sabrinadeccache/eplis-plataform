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

// **Achado da revisão (2026-09-12, M3): bloqueio de conta não parava
// requisição já em voo.** `purgeUserRecordings` marca a conta como
// `blocked` antes de tocar em qualquer dado, e `authorize()` (M1) rejeita
// toda ação de conta não-`active` — mas isso só fecha a porta pra
// requisições NOVAS. Uma requisição que já tinha passado por `authorize()`
// no instante exato do bloqueio segue rodando (decode de áudio, chamada de
// IA) e só termina de gravar depois — recriando conteúdo que a exclusão
// deveria ter apagado. A Sabrina recusou aceitar isso como limitação
// documentada.
//
// Não dá pra eliminar a corrida por completo sem lock distribuído (fora de
// escopo aqui), mas dá pra fechar a janela prática: chamar isto de novo,
// bem antes do ponto em que a rota persiste qualquer conteúdo (upload do
// áudio, ou a escrita subsequente de `audio_path`) — não só no início da
// requisição. Reduz a janela de "todo o tempo de processamento" (que inclui
// o decode do ffmpeg e a ida à API de transcrição, segundos de sobra pro
// cron/exclusão rodar no meio) pro intervalo bem mais curto entre esta
// checagem e a escrita seguinte.
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
