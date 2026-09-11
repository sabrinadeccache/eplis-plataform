// Limites de taxa por tentativa, pra dificultar abuso mesmo depois que o
// guard de item (item-guard.ts) já garante que cada slot só vira uma
// resposta — sem isto, alguém que controla a requisição (fora do app) podia
// martelar a rota rapidamente, ou uma tentativa travada num loop de retry
// não teria teto nenhum de quantas linhas ela acumula. Consultado no banco
// (não em memória do processo) de propósito: funções serverless da Vercel
// não compartilham memória entre instâncias, então um limitador em memória
// não seguraria nada de verdade.
import { ItemGuardError, type ItemGuardTable } from "@/lib/simulations/item-guard";
import type { SupabaseServerClient } from "@/lib/simulations/attempt-guards";

// Janela curta: uma resposta por vez é o fluxo real (o candidato só grava e
// envia depois que a anterior terminou de processar) — 2 no intervalo dá
// folga pra 1 retry legítimo do próprio cliente sem travar uso normal.
const BURST_WINDOW_SECONDS = 5;
const MAX_SUBMISSIONS_PER_BURST_WINDOW = 2;

// Teto de linhas por tentativa: o máximo de slots reais é 30 (Fase 2) / 36
// (SDEA) — ver response-stages.ts de cada trilha. 60 dá margem generosa pra
// retries de erro sem deixar uma tentativa acumular volume ilimitado.
const MAX_RESPONSES_PER_ATTEMPT = 60;

function windowStartIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

export async function assertSubmissionRate(
  supabase: SupabaseServerClient,
  table: ItemGuardTable,
  attemptId: string,
): Promise<void> {
  const { count: burstCount } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("simulation_attempt_id", attemptId)
    .gte("created_at", windowStartIso(BURST_WINDOW_SECONDS));

  if ((burstCount ?? 0) >= MAX_SUBMISSIONS_PER_BURST_WINDOW) {
    throw new ItemGuardError("Aguarde alguns segundos antes de enviar de novo.", 429);
  }

  const { count: attemptCount } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("simulation_attempt_id", attemptId);

  if ((attemptCount ?? 0) >= MAX_RESPONSES_PER_ATTEMPT) {
    throw new ItemGuardError("Limite de respostas desta tentativa foi atingido.", 429);
  }
}
