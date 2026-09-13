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

// Só metadado de contagem — nunca transcrição, nome de titular ou conteúdo
// da gravação (o plano pede explicitamente "registrar acesso administrativo
// sem conteúdo sensível" — o mesmo princípio vale pra qualquer relatório
// operacional deste módulo).
export type ExpiryReport = {
  dryRun: boolean;
  byTrack: Record<RecordingTrack, { expired: number; storageDeleted: number; rowsCleared: number }>;
  errors: string[];
};

type PendingExpiryRow = { id: string; simulation_attempt_id: string; user_id: string | null };

// **Achado da revisão (2026-09-12): sem paginação, um backlog grande de
// gravações vencidas era processado só parcialmente** (o `limit` cortava
// silenciosamente o resto, que só seria pego na próxima execução — ok pra
// um cron diário de rotina, mas quebra a garantia de "processa tudo que
// está vencido agora" que um dry-run de verificação precisa dar). Agora
// pagina de verdade: em dry-run, por `range` (as linhas não mudam entre
// páginas); aplicando de verdade, repete a MESMA consulta (sem offset) até
// vir vazia — cada lote processado sai do filtro (`audio_path` zerado),
// então a consulta seguinte já pega o próximo lote.
async function fetchExpiredBatch(
  admin: ReturnType<typeof createAdminClient>,
  table: "phase2_responses" | "pilot_responses",
  nowIso: string,
  range: [number, number],
): Promise<{ rows: PendingExpiryRow[]; error: string | null }> {
  const { data, error } = await admin
    .from(table)
    .select("id, simulation_attempt_id, simulation_attempts(user_id)")
    .not("audio_path", "is", null)
    .lte("expires_at", nowIso)
    .order("id", { ascending: true })
    .range(range[0], range[1]);

  if (error) return { rows: [], error: error.message };

  const rows = ((data ?? []) as unknown as {
    id: string;
    simulation_attempt_id: string;
    simulation_attempts: { user_id: string | null } | { user_id: string | null }[] | null;
  }[]).map((r) => {
    const attempt = Array.isArray(r.simulation_attempts) ? r.simulation_attempts[0] : r.simulation_attempts;
    return { id: r.id, simulation_attempt_id: r.simulation_attempt_id, user_id: attempt?.user_id ?? null };
  });
  return { rows, error: null };
}

// Processo de expiração IDEMPOTENTE: seleciona linhas com gravação vencida,
// apaga o objeto no Storage e zera `audio_path`. Rodar de novo depois de
// aplicado não reprocessa nada — a linha já não bate no filtro.
//
// O caminho do objeto é DERIVADO DOS IDS (`buildRecordingPath`), não lido
// da coluna `audio_path` — mais robusto contra a linha ter ficado num
// estado parcial (upload no bucket concluído, mas a escrita de
// `audio_path`/`expires_at` na mesma chamada tendo falhado antes; ver
// achado equivalente nas rotas de submit-response). Como o caminho é
// determinístico por `responseId`, remover por ID sempre acerta o objeto
// certo, exista ele ou não — `remove()` num caminho ausente não é erro.
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

  const report: ExpiryReport = {
    dryRun,
    byTrack: {
      phase2: { expired: 0, storageDeleted: 0, rowsCleared: 0 },
      pilot: { expired: 0, storageDeleted: 0, rowsCleared: 0 },
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

      const paths = rows.map((r) =>
        buildRecordingPath({
          userId: r.user_id ?? "anon",
          attemptId: r.simulation_attempt_id,
          responseId: r.id,
        }),
      );
      const { error: storageError } = await admin.storage.from(recordingBucket(track)).remove(paths);
      if (storageError) {
        // Não zera `audio_path` se o objeto não foi removido — assim a
        // próxima execução tenta de novo, em vez de perder o ponteiro e
        // deixar a gravação órfã no bucket pra sempre.
        report.errors.push(`${track}: falha ao remover do storage (${storageError.message})`);
        break;
      }
      report.byTrack[track].storageDeleted += rows.length;

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
// - `audio_url` LEGADO (URL pública de antes do M3.1) também é limpo —
//   preservá-lo não expõe nada hoje (o bucket é privado, a URL não
//   funciona mais), mas é conteúdo remanescente ligado ao titular que não
//   tem por que sobreviver à exclusão.
//
// **Achado da revisão (2026-09-12), corrigido nesta função:**
// 1. Faltava paginação — uma conta com muitas respostas só tinha uma parte
//    limpa (limite implícito de linhas por consulta), e o script achava
//    que tinha terminado. Agora pagina de verdade (tentativas, respostas e
//    feedbacks) até esgotar.
// 2. Nada impedia um NOVO envio durante ou logo após a limpeza (a conta
//    continuava `active` até o `deleteUser` final, minutos depois pra uma
//    conta grande). Agora, antes de tocar em qualquer dado (fora de
//    dry-run), a conta é marcada `blocked` — `authorize()` (M1) já rejeita
//    toda ação de uma conta não-`active`, então nenhuma submissão nova
//    consegue passar da autorização a partir daqui.
// 3. `general_feedback` e `audio_url` legado não eram limpos.
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

  const ATTEMPT_CHUNK = 200;

  for (const { track, table } of TRACKS) {
    for (const idsChunk of chunk(attemptIds, ATTEMPT_CHUNK)) {
      const { data, error } = await admin
        .from(table)
        .select("id, simulation_attempt_id, audio_path")
        .in("simulation_attempt_id", idsChunk);
      if (error) {
        report.errors.push(`${track}: falha ao listar respostas (${error.message})`);
        continue;
      }

      const rows = (data ?? []) as { id: string; simulation_attempt_id: string; audio_path: string | null }[];
      if (rows.length === 0) continue;
      report.responsesCleared += rows.length;
      if (dryRun) continue;

      // Caminho derivado dos IDs, não da coluna `audio_path` — cobre
      // também a linha cujo upload terminou mas nunca chegou a gravar
      // `audio_path` (achado da revisão). `remove()` num caminho que não
      // existe de fato não é erro.
      const paths = rows.map((r) =>
        buildRecordingPath({ userId, attemptId: r.simulation_attempt_id, responseId: r.id }),
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
