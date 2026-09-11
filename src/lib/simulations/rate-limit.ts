// Limites de taxa por tentativa/usuário, pra dificultar abuso mesmo depois
// que o guard de item (item-guard.ts) já garante que cada slot só vira uma
// resposta e que retry de um mesmo slot tem teto próprio
// (`MAX_RETRIES_PER_SLOT`). Consultado no banco (não em memória do
// processo) de propósito: funções serverless da Vercel não compartilham
// memória entre instâncias, então um limitador em memória não seguraria
// nada de verdade.
//
// **Achado da revisão (2026-09-11): usar `created_at` pra medir a janela
// deixava retry de fora** — um retry reaproveita a MESMA linha (só muda
// `processing_status`/`started_at`/`retry_count`, `item-guard.ts`), então
// uma sequência de retries rápidos nunca criava linha nova e não contava
// pra janela curta. Trocado pra `started_at`, que o guard atualiza em TODO
// retry. Todas as consultas falham FECHADO: erro de leitura no banco vira
// rejeição (503), nunca "assume que está tudo bem" (achado real: a versão
// anterior devolvia `count ?? 0`, ou seja, uma falha na consulta liberava a
// requisição sem checagem nenhuma).
import { ItemGuardError, type ItemGuardTable } from "@/lib/simulations/item-guard";
import type { SupabaseServerClient } from "@/lib/simulations/attempt-guards";

// Janela curta: uma resposta por vez é o fluxo real (o candidato só grava e
// envia depois que a anterior terminou de processar) — 2 no intervalo dá
// folga pra 1 retry legítimo do próprio cliente sem travar uso normal.
const BURST_WINDOW_SECONDS = 5;
const MAX_SUBMISSIONS_PER_BURST_WINDOW = 2;

// Teto de linhas por tentativa: o máximo de slots reais é 30 (Fase 2) / 36
// (SDEA) — ver response-stages.ts de cada trilha. 60 dá margem generosa sem
// deixar uma tentativa acumular volume ilimitado (retries não contam aqui —
// eles têm o próprio teto em item-guard.ts).
const MAX_RESPONSES_PER_ATTEMPT = 60;

// Teto agregado por usuário/dia — independente do teto diário de
// TENTATIVAS (`DAILY_ATTEMPT_LIMIT`/`PILOT_DAILY_ATTEMPT_LIMIT`): protege
// mesmo se uma única tentativa, por bug ou abuso, gerar volume anômalo de
// respostas. Generoso o bastante pra cobrir o teto de tentativas × o máximo
// real de slots por tentativa (5 × 36 = 180) com folga.
const MAX_RESPONSES_PER_USER_PER_DAY = 250;

function windowStartIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

async function countOrFail(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  onErrorMessage: string,
): Promise<number> {
  const { count, error } = await query;
  if (error) {
    throw new ItemGuardError(onErrorMessage, 503);
  }
  return count ?? 0;
}

export async function assertSubmissionRate(
  supabase: SupabaseServerClient,
  table: ItemGuardTable,
  attemptId: string,
  userId: string,
): Promise<void> {
  const burstCount = await countOrFail(
    supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("simulation_attempt_id", attemptId)
      .gte("started_at", windowStartIso(BURST_WINDOW_SECONDS)),
    "Não foi possível verificar o limite de envio. Tente novamente.",
  );
  if (burstCount >= MAX_SUBMISSIONS_PER_BURST_WINDOW) {
    throw new ItemGuardError("Aguarde alguns segundos antes de enviar de novo.", 429);
  }

  const attemptCount = await countOrFail(
    supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("simulation_attempt_id", attemptId),
    "Não foi possível verificar o limite de envio. Tente novamente.",
  );
  if (attemptCount >= MAX_RESPONSES_PER_ATTEMPT) {
    throw new ItemGuardError("Limite de respostas desta tentativa foi atingido.", 429);
  }

  // Embutido: PostgREST resolve o join via a FK real de
  // simulation_attempt_id -> simulation_attempts (a tabela existe no banco
  // com a FK declarada; os tipos hand-written em src/types/database.ts não
  // modelam `Relationships`, então o filtro abaixo é aceito em runtime mas
  // precisa de cast — mesmo padrão já usado em queries.ts/actions.ts pra
  // embeds de FK).
  const dayCount = await countOrFail(
    supabase
      .from(table)
      .select("id, simulation_attempts!inner(user_id)", { count: "exact", head: true })
      .eq("simulation_attempts.user_id", userId)
      .gte("started_at", startOfTodayIso()) as unknown as PromiseLike<{
      count: number | null;
      error: { message: string } | null;
    }>,
    "Não foi possível verificar o limite diário. Tente novamente.",
  );
  if (dayCount >= MAX_RESPONSES_PER_USER_PER_DAY) {
    throw new ItemGuardError("Limite diário de respostas atingido.", 429);
  }
}
