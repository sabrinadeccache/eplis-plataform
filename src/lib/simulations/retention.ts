// Retenção das gravações de voz — Milestone 3.2 do plano de correção (ver
// docs/project-status.md). Prazos definidos pela Sabrina: practice 30 dias,
// official 180 dias. Transcrição, feedback e notas NÃO expiram — só o
// áudio, que é o dado pessoal sensível e cuja finalidade (gerar transcrição
// e feedback) se esgota depois de cumprida.
import type { createAdminClient } from "@/lib/supabase/admin";
import { buildRecordingPath, recordingBucket, type RecordingTrack } from "@/lib/simulations/recording-access";
import type { SimulationMode } from "@/types/database";

export const RETENTION_DAYS: Record<SimulationMode, number> = {
  practice: 30,
  official: 180,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function recordingExpiresAt(mode: SimulationMode, from: Date = new Date()): string {
  return new Date(from.getTime() + RETENTION_DAYS[mode] * DAY_MS).toISOString();
}

const TRACKS: { track: RecordingTrack; table: "phase2_responses" | "pilot_responses" }[] = [
  { track: "phase2", table: "phase2_responses" },
  { track: "pilot", table: "pilot_responses" },
];

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// **Achado da revisão (2026-09-12): derivar SÓ pelos IDs perdia as
// gravações legadas.** A rodada anterior parou de ler `audio_path` pra
// decidir o que apagar (só pra fechar o caso de upload bem-sucedido com a
// escrita de `audio_path` falhando depois) — mas isso quebrou o caso
// comum: gravações antigas (de antes do caminho determinístico, ou até de
// antes do M3.1, formato `{attemptId}/{arquivo}`) continuam em
// `audio_path`, num caminho DIFERENTE do que `buildRecordingPath` calcula
// hoje. Removendo só o caminho calculado, o objeto real (no caminho
// antigo) nunca era tocado — e como remover um caminho inexistente não dá
// erro, o código achava que tinha limpado e zerava a referência mesmo
// assim, perdendo o único jeito de achar aquele objeto de novo.
//
// Correção: sempre que existir `audio_path` na linha, ele é o endereço
// SOMADO ao caminho determinístico (não substituído) — cobre os dois casos
// de uma vez: o objeto no caminho antigo (se a linha é de antes desta
// mudança) e o objeto no caminho novo (se a linha já é atual, ou se o
// upload girou pro caminho novo mas a escrita de `audio_path` falhou).
function candidatePaths(row: { audio_path: string | null }, ids: { userId: string; attemptId: string; responseId: string }): string[] {
  const deterministic = buildRecordingPath(ids);
  return row.audio_path && row.audio_path !== deterministic ? [row.audio_path, deterministic] : [deterministic];
}

// Só metadado de contagem — nunca transcrição, nome de titular ou conteúdo
// da gravação (o plano pede explicitamente "registrar acesso administrativo
// sem conteúdo sensível" — o mesmo princípio vale pra qualquer relatório
// operacional deste módulo).
export type ExpiryReport = {
  dryRun: boolean;
  byTrack: Record<RecordingTrack, { expired: number; storageDeleted: number; rowsCleared: number; orphansSwept: number }>;
  errors: string[];
};

type PendingExpiryRow = { id: string; simulation_attempt_id: string; audio_path: string | null; user_id: string | null };

async function fetchExpiredBatch(
  admin: ReturnType<typeof createAdminClient>,
  table: "phase2_responses" | "pilot_responses",
  nowIso: string,
  range: [number, number],
): Promise<{ rows: PendingExpiryRow[]; error: string | null }> {
  const { data, error } = await admin
    .from(table)
    .select("id, simulation_attempt_id, audio_path, simulation_attempts(user_id)")
    .not("audio_path", "is", null)
    .lte("expires_at", nowIso)
    .order("id", { ascending: true })
    .range(range[0], range[1]);

  if (error) return { rows: [], error: error.message };

  const rows = ((data ?? []) as unknown as {
    id: string;
    simulation_attempt_id: string;
    audio_path: string | null;
    simulation_attempts: { user_id: string | null } | { user_id: string | null }[] | null;
  }[]).map((r) => {
    const attempt = Array.isArray(r.simulation_attempts) ? r.simulation_attempts[0] : r.simulation_attempts;
    return {
      id: r.id,
      simulation_attempt_id: r.simulation_attempt_id,
      audio_path: r.audio_path,
      user_id: attempt?.user_id ?? null,
    };
  });
  return { rows, error: null };
}

// **Achado da revisão (2026-09-12): upload cuja persistência falhou podia
// ficar pra sempre sem dono.** Se o objeto sobe no Storage mas a escrita de
// `audio_path`/`expires_at` falha logo depois (ambos ficam `null`), a linha
// nunca bate no filtro principal (`audio_path is not null`) — nem esta
// função nem o cron a alcançam, e se o candidato nunca tentar de novo
// aquele item, o objeto fica órfão indefinidamente. Esta 2ª varredura pega
// exatamente esse caso: `audio_path` nulo, estágio marcado como erro
// (é o que a rota grava nesse cenário), e ANTIGO o bastante (usa o prazo
// mais curto, 30 dias, como corte de "isso não vai ser retentado") — tenta
// remover o caminho determinístico de qualquer forma (sem erro se não
// existir) pra cobrir o caso em que o objeto está lá mas sem `audio_path`
// nenhum apontando pra ele.
async function sweepOrphanedUploads(
  admin: ReturnType<typeof createAdminClient>,
  table: "phase2_responses" | "pilot_responses",
  track: RecordingTrack,
  cutoffIso: string,
  dryRun: boolean,
): Promise<{ swept: number; error: string | null }> {
  const { data, error } = await admin
    .from(table)
    .select("id, simulation_attempt_id, simulation_attempts(user_id)")
    .is("audio_path", null)
    .eq("processing_status", "error")
    .lte("created_at", cutoffIso)
    .limit(500);

  if (error) return { swept: 0, error: error.message };
  const rows = (data ?? []) as unknown as {
    id: string;
    simulation_attempt_id: string;
    simulation_attempts: { user_id: string | null } | { user_id: string | null }[] | null;
  }[];
  if (rows.length === 0 || dryRun) return { swept: rows.length, error: null };

  const paths = rows.map((r) => {
    const attempt = Array.isArray(r.simulation_attempts) ? r.simulation_attempts[0] : r.simulation_attempts;
    return buildRecordingPath({
      userId: attempt?.user_id ?? "anon",
      attemptId: r.simulation_attempt_id,
      responseId: r.id,
    });
  });
  const { error: storageError } = await admin.storage.from(recordingBucket(track)).remove(paths);
  if (storageError) return { swept: 0, error: storageError.message };
  return { swept: rows.length, error: null };
}

// Processo de expiração IDEMPOTENTE: seleciona linhas com gravação vencida,
// apaga o(s) objeto(s) no Storage e zera `audio_path`. Rodar de novo depois
// de aplicado não reprocessa nada — a linha já não bate no filtro.
//
// `dryRun` (padrão) não apaga nada: só conta o que seria apagado. É o que
// permite verificar a retenção sem tocar em dado de produção.
export async function expireRecordings(params: {
  admin: ReturnType<typeof createAdminClient>;
  now?: Date;
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
}): Promise<ExpiryReport> {
  const { admin, now = new Date(), dryRun = true, batchSize = 500, maxBatches = 50 } = params;
  const nowIso = now.toISOString();
  const orphanCutoffIso = new Date(now.getTime() - RETENTION_DAYS.practice * DAY_MS).toISOString();

  const report: ExpiryReport = {
    dryRun,
    byTrack: {
      phase2: { expired: 0, storageDeleted: 0, rowsCleared: 0, orphansSwept: 0 },
      pilot: { expired: 0, storageDeleted: 0, rowsCleared: 0, orphansSwept: 0 },
    },
    errors: [],
  };

  for (const { track, table } of TRACKS) {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      // Sem `offset` quando aplicando de verdade: cada lote processado sai
      // do filtro, então a "página 0" sempre é o próximo lote pendente. Em
      // dry-run (nada é removido), usa `range` de verdade pra não reler o
      // mesmo lote pra sempre.
      const range: [number, number] = dryRun
        ? [batch * batchSize, batch * batchSize + batchSize - 1]
        : [0, batchSize - 1];

      const { rows, error } = await fetchExpiredBatch(admin, table, nowIso, range);
      if (error) {
        report.errors.push(`${track}: falha ao listar vencidas (${error})`);
        break;
      }
      if (rows.length === 0) break;

      report.byTrack[track].expired += rows.length;
      if (dryRun) {
        if (rows.length < batchSize) break;
        continue;
      }

      const paths = rows.flatMap((r) =>
        candidatePaths(r, { userId: r.user_id ?? "anon", attemptId: r.simulation_attempt_id, responseId: r.id }),
      );
      const { error: storageError } = await admin.storage.from(recordingBucket(track)).remove(paths);
      if (storageError) {
        // Não zera `audio_path` se o objeto não foi removido — assim a
        // próxima execução tenta de novo, em vez de perder o ponteiro e
        // deixar a gravação órfã no bucket pra sempre.
        report.errors.push(`${track}: falha ao remover do storage (${storageError.message})`);
        break;
      }
      report.byTrack[track].storageDeleted += paths.length;

      const { error: clearError } = await admin
        .from(table)
        .update({ audio_path: null })
        .in("id", rows.map((r) => r.id));
      if (clearError) {
        report.errors.push(`${track}: storage limpo mas falha ao zerar audio_path (${clearError.message})`);
        break;
      }
      report.byTrack[track].rowsCleared += rows.length;

      if (rows.length < batchSize) break;
    }

    const { swept, error: sweepError } = await sweepOrphanedUploads(admin, table, track, orphanCutoffIso, dryRun);
    if (sweepError) report.errors.push(`${track}: falha na varredura de órfãos (${sweepError})`);
    else report.byTrack[track].orphansSwept = swept;
  }

  return report;
}

export type UserDataReport = {
  dryRun: boolean;
  storageObjectsRemoved: number;
  responsesCleared: number;
  feedbacksCleared: number;
  accountBlocked: boolean;
  errors: string[];
};

async function fetchAllAttemptIds(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 500;
  for (let page = 0; ; page += 1) {
    const { data, error } = await admin
      .from("simulation_attempts")
      .select("id")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw new Error(`falha ao listar tentativas do usuário (${error.message})`);
    const rows = (data ?? []) as { id: string }[];
    ids.push(...rows.map((r) => r.id));
    if (rows.length < pageSize) break;
  }
  return ids;
}

const ATTEMPT_CHUNK = 200;
const RESPONSE_PAGE_SIZE = 500;

// **Achado da revisão (2026-09-12): agrupar tentativas não pagina
// respostas.** A versão anterior fazia UMA consulta por bloco de 200
// tentativas — com até ~36 respostas por tentativa, um bloco podia ter
// milhares de linhas, e a consulta ficava sujeita ao limite implícito do
// banco sem nenhum aviso. Esta função pagina de verdade DENTRO de cada
// bloco de tentativas, com `range`, até esgotar — só então a exclusão pode
// considerar aquele bloco concluído.
async function fetchAllResponsesForAttempts(
  admin: ReturnType<typeof createAdminClient>,
  table: "phase2_responses" | "pilot_responses",
  attemptIdsChunk: string[],
): Promise<{ rows: { id: string; simulation_attempt_id: string; audio_path: string | null }[]; error: string | null }> {
  const rows: { id: string; simulation_attempt_id: string; audio_path: string | null }[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await admin
      .from(table)
      .select("id, simulation_attempt_id, audio_path")
      .in("simulation_attempt_id", attemptIdsChunk)
      .order("id", { ascending: true })
      .range(page * RESPONSE_PAGE_SIZE, page * RESPONSE_PAGE_SIZE + RESPONSE_PAGE_SIZE - 1);
    if (error) return { rows, error: error.message };
    const batch = (data ?? []) as { id: string; simulation_attempt_id: string; audio_path: string | null }[];
    rows.push(...batch);
    if (batch.length < RESPONSE_PAGE_SIZE) break;
  }
  return { rows, error: null };
}

// Exclusão de conta (decisão da Sabrina: apaga o áudio, mantém o resultado
// ANONIMIZADO). Este passo cuida do que o Postgres não cuida sozinho:
//
// - o Storage não participa de cascade, então as gravações precisam ser
//   removidas explicitamente (por isso este processo roda ANTES de apagar a
//   conta em `scripts/delete-user-data.mjs`);
// - transcrição, feedback POR RESPOSTA e o `general_feedback` do relatório
//   final (`simulation_feedbacks`) são CONTEÚDO DE FALA do titular — dado
//   pessoal, mesmo sem o áudio. Mantê-los ligados a uma tentativa "anônima"
//   não anonimizaria de verdade (o teor do que a pessoa falou pode
//   reidentificar). São zerados aqui; ficam as notas dos 6 critérios, a
//   pontuação geral e as datas, que é o que sustenta estatística agregada.
// - `audio_url` LEGADO (URL pública de antes do M3.1) também é limpo.
//
// A conta é marcada `blocked` ANTES de tocar em qualquer dado (fora de
// dry-run) — `authorize()` (M1) já rejeita toda ação de uma conta
// não-`active`, fechando a autorização pra qualquer submissão NOVA a partir
// daqui. **Limite reconhecido, não uma garantia absoluta:** uma requisição
// que já passou por `authorize()` ANTES do bloqueio continua rodando até o
// fim (o bloqueio não cancela trabalho em andamento) — as rotas de
// submit-response (M3, revisão 2026-09-12) mitigam isso com uma 2ª checagem
// de status logo antes de gravar qualquer conteúdo, o que reduz essa janela
// de "todo o tempo de processamento" pra "o intervalo entre essa checagem e
// a escrita", mas não elimina a corrida por completo — ver
// `assertAccountStillActive` em `src/lib/simulations/attempt-guards.ts` e o
// comentário nas duas rotas.
//
// O desvínculo da tentativa (`user_id` → NULL) é feito pelo próprio banco
// quando a conta é removida, via `on delete set null`
// (migration 20260912030000) — chamado por quem invoca esta função DEPOIS
// dela retornar (ver scripts/delete-user-data.mjs).
export async function purgeUserRecordings(params: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  dryRun?: boolean;
}): Promise<UserDataReport> {
  const { admin, userId, dryRun = true } = params;
  const report: UserDataReport = {
    dryRun,
    storageObjectsRemoved: 0,
    responsesCleared: 0,
    feedbacksCleared: 0,
    accountBlocked: false,
    errors: [],
  };

  if (!dryRun) {
    const { error: blockError } = await admin.from("users").update({ status: "blocked" }).eq("id", userId);
    if (blockError) {
      report.errors.push(`falha ao bloquear a conta antes da limpeza (${blockError.message})`);
      return report;
    }
    report.accountBlocked = true;
  }

  let attemptIds: string[];
  try {
    attemptIds = await fetchAllAttemptIds(admin, userId);
  } catch (e) {
    report.errors.push(e instanceof Error ? e.message : String(e));
    return report;
  }
  if (attemptIds.length === 0) return report;

  for (const { track, table } of TRACKS) {
    for (const idsChunk of chunk(attemptIds, ATTEMPT_CHUNK)) {
      const { rows, error } = await fetchAllResponsesForAttempts(admin, table, idsChunk);
      if (error) {
        report.errors.push(`${track}: falha ao listar respostas (${error})`);
        continue;
      }
      if (rows.length === 0) continue;
      report.responsesCleared += rows.length;
      if (dryRun) continue;

      const paths = rows.flatMap((r) =>
        candidatePaths(r, { userId, attemptId: r.simulation_attempt_id, responseId: r.id }),
      );
      const { error: storageError } = await admin.storage.from(recordingBucket(track)).remove(paths);
      if (storageError) {
        report.errors.push(`${track}: falha ao remover gravações (${storageError.message})`);
        continue;
      }
      report.storageObjectsRemoved += paths.length;

      const { error: clearError } = await admin
        .from(table)
        .update({ audio_path: null, audio_url: null, transcript: null, ai_feedback: null })
        .in("id", rows.map((r) => r.id));
      if (clearError) {
        report.errors.push(`${track}: falha ao limpar conteúdo de fala (${clearError.message})`);
      }
    }
  }

  if (!dryRun) {
    for (const idsChunk of chunk(attemptIds, ATTEMPT_CHUNK)) {
      const { data, error: countError } = await admin
        .from("simulation_feedbacks")
        .select("id")
        .in("simulation_attempt_id", idsChunk);
      if (countError) {
        report.errors.push(`simulation_feedbacks: falha ao listar (${countError.message})`);
        continue;
      }
      const feedbackRows = (data ?? []) as { id: string }[];
      if (feedbackRows.length === 0) continue;

      const { error: clearError } = await admin
        .from("simulation_feedbacks")
        .update({ general_feedback: null })
        .in("id", feedbackRows.map((r) => r.id));
      if (clearError) {
        report.errors.push(`simulation_feedbacks: falha ao limpar general_feedback (${clearError.message})`);
        continue;
      }
      report.feedbacksCleared += feedbackRows.length;
    }
  }

  return report;
}
