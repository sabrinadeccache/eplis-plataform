// Limites de taxa por tentativa/usuário, pra dificultar abuso mesmo depois
// que o guard de item (item-guard.ts) já garante que cada slot só vira uma
// resposta e que retry de um mesmo slot tem teto próprio
// (`MAX_RETRIES_PER_SLOT`). Consultado no banco (não em memória do
// processo) de propósito: funções serverless da Vercel não compartilham
// memória entre instâncias, então um limitador em memória não seguraria
// nada de verdade.
//
// **Achado da revisão (2026-09-11, 2ª rodada): medir a janela contando
// LINHAS não funciona pra retry, nem trocando pra `started_at`** — um
// retry reaproveita a MESMA linha (`item-guard.ts`), então o número de
// linhas que batem num filtro de tempo continua sendo 1 (a linha), não
// quantas vezes ela foi de fato reenviada — 5 retries seguidos do mesmo
// slot em 1 segundo continuavam contando como "1" nesse esquema. A
// correção de verdade é medir a TAXA DE ENVIO em si, não linhas de
// resultado: `assertSubmissionCooldown` faz um UPDATE condicional
// (compare-and-swap) num timestamp dedicado em `simulation_attempts`
// (`last_submission_at`, migration `20260911010000_m2_review_fixes.sql`) —
// TODA submissão (inclusive retry) precisa passar por essa trava antes de
// tocar em qualquer linha de resposta, e o CAS só deixa passar 1 a cada
// `MIN_SUBMISSION_INTERVAL_SECONDS`, não importa se é slot novo ou retry do
// mesmo slot.
import { ItemGuardError, type ItemGuardTable } from "@/lib/simulations/item-guard";
import type { SupabaseServerClient } from "@/lib/simulations/attempt-guards";
import type { createAdminClient } from "@/lib/supabase/admin";

// Intervalo mínimo entre duas submissões da MESMA tentativa, contando
// retries — o fluxo real do candidato é gravar, esperar processar, só
// então enviar de novo, então isto não trava uso normal.
const MIN_SUBMISSION_INTERVAL_SECONDS = 2;

// Teto de linhas por tentativa: o máximo de slots reais é 30 (Fase 2) / 36
// (SDEA) — ver response-stages.ts de cada trilha. 60 dá margem generosa
// sobre isso (retries não engordam esse número — eles reusam a linha e têm
// teto próprio em item-guard.ts; este teto é defesa contra volume de itens
// NOVOS anômalo, não contra retry).
const MAX_RESPONSES_PER_ATTEMPT = 60;

// Teto agregado por usuário/dia — independente do teto diário de
// TENTATIVAS (`DAILY_ATTEMPT_LIMIT`/`PILOT_DAILY_ATTEMPT_LIMIT`): protege
// mesmo se uma única tentativa, por bug ou abuso, gerar volume anômalo de
// respostas. Generoso o bastante pra cobrir o teto de tentativas × o máximo
// real de slots por tentativa (5 × 36 = 180) com folga.
const MAX_RESPONSES_PER_USER_PER_DAY = 250;

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

// CAS num timestamp dedicado da própria tentativa — não depende de linhas
// de resposta existirem, então mede a taxa de envio de verdade, inclusive
// retries do mesmo slot. `.or(...)` cobre a 1ª submissão da tentativa
// (`last_submission_at` ainda `null`) e qualquer submissão depois do
// intervalo mínimo; o `update` só afeta 1 linha quando alguma dessas
// condições bate, então duas requisições simultâneas nunca passam as duas —
// a que perde a corrida do UPDATE recebe `data: null` de volta.
async function assertSubmissionCooldown(
  admin: ReturnType<typeof createAdminClient>,
  attemptId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - MIN_SUBMISSION_INTERVAL_SECONDS * 1000).toISOString();

  const { data, error } = await admin
    .from("simulation_attempts")
    .update({ last_submission_at: nowIso })
    .eq("id", attemptId)
    .or(`last_submission_at.is.null,last_submission_at.lte.${cutoffIso}`)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new ItemGuardError("Não foi possível verificar o limite de envio. Tente novamente.", 503);
  }
  if (!data) {
    throw new ItemGuardError("Aguarde alguns segundos antes de enviar de novo.", 429);
  }
}

export async function assertSubmissionRate(
  supabase: SupabaseServerClient,
  admin: ReturnType<typeof createAdminClient>,
  table: ItemGuardTable,
  attemptId: string,
  userId: string,
): Promise<void> {
  await assertSubmissionCooldown(admin, attemptId);

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
      .gte("created_at", startOfTodayIso()) as unknown as PromiseLike<{
      count: number | null;
      error: { message: string } | null;
    }>,
    "Não foi possível verificar o limite diário. Tente novamente.",
  );
  if (dayCount >= MAX_RESPONSES_PER_USER_PER_DAY) {
    throw new ItemGuardError("Limite diário de respostas atingido.", 429);
  }
}
