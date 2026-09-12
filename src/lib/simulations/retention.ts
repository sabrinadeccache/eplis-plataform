// Retenção das gravações de voz — Milestone 3.2 do plano de correção (ver
// docs/project-status.md). Prazos definidos pela Sabrina: practice 30 dias,
// official 180 dias. Transcrição, feedback e notas NÃO expiram — só o
// áudio, que é o dado pessoal sensível e cuja finalidade (gerar transcrição
// e feedback) se esgota depois de cumprida.
import type { createAdminClient } from "@/lib/supabase/admin";
import { recordingBucket, type RecordingTrack } from "@/lib/simulations/recording-access";
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

// Só metadado de contagem — nunca transcrição, nome de titular ou conteúdo
// da gravação (o plano pede explicitamente "registrar acesso administrativo
// sem conteúdo sensível").
export type ExpiryReport = {
  dryRun: boolean;
  byTrack: Record<RecordingTrack, { expired: number; storageDeleted: number; rowsCleared: number }>;
  errors: string[];
};

// Processo de expiração IDEMPOTENTE: seleciona só linhas que ainda têm
// `audio_path` e cujo `expires_at` já passou; apaga o objeto no Storage e
// zera `audio_path`. Rodar duas vezes seguidas não faz nada na segunda —
// depois de zerado, a linha sai do conjunto (e do índice parcial criado na
// migration 20260912020000).
//
// `dryRun` (padrão) não apaga nada: só conta o que seria apagado. É o que
// permite verificar a retenção sem tocar em dado de produção.
export async function expireRecordings(params: {
  admin: ReturnType<typeof createAdminClient>;
  now?: Date;
  dryRun?: boolean;
  limit?: number;
}): Promise<ExpiryReport> {
  const { admin, now = new Date(), dryRun = true, limit = 500 } = params;

  const report: ExpiryReport = {
    dryRun,
    byTrack: {
      phase2: { expired: 0, storageDeleted: 0, rowsCleared: 0 },
      pilot: { expired: 0, storageDeleted: 0, rowsCleared: 0 },
    },
    errors: [],
  };

  for (const { track, table } of TRACKS) {
    const { data, error } = await admin
      .from(table)
      .select("id, audio_path")
      .not("audio_path", "is", null)
      .lte("expires_at", now.toISOString())
      .limit(limit);

    if (error) {
      report.errors.push(`${track}: falha ao listar vencidas (${error.message})`);
      continue;
    }

    const rows = (data ?? []) as unknown as { id: string; audio_path: string }[];
    report.byTrack[track].expired = rows.length;
    if (rows.length === 0 || dryRun) continue;

    const { error: storageError } = await admin.storage
      .from(recordingBucket(track))
      .remove(rows.map((r) => r.audio_path));

    if (storageError) {
      // Não zera `audio_path` se o objeto não foi removido — assim a
      // próxima execução tenta de novo, em vez de perder o ponteiro e
      // deixar a gravação órfã no bucket pra sempre.
      report.errors.push(`${track}: falha ao remover do storage (${storageError.message})`);
      continue;
    }
    report.byTrack[track].storageDeleted = rows.length;

    const { error: clearError } = await admin
      .from(table)
      .update({ audio_path: null })
      .in(
        "id",
        rows.map((r) => r.id),
      );

    if (clearError) {
      report.errors.push(`${track}: storage limpo mas falha ao zerar audio_path (${clearError.message})`);
      continue;
    }
    report.byTrack[track].rowsCleared = rows.length;
  }

  return report;
}

export type UserDataReport = {
  dryRun: boolean;
  storageObjects: number;
  responsesCleared: number;
  errors: string[];
};

// Exclusão de conta (decisão da Sabrina: apaga o áudio, mantém o resultado
// ANONIMIZADO). Este passo cuida do que o Postgres não cuida sozinho:
//
// - o Storage não participa de cascade, então as gravações precisam ser
//   removidas explicitamente (por isso este processo roda ANTES de apagar a
//   conta);
// - transcrição e feedback são CONTEÚDO DE FALA do titular, ou seja, dado
//   pessoal: mantê-los ligados a uma tentativa "anônima" não anonimizaria
//   de verdade (o teor do que a pessoa falou pode reidentificar). São
//   zerados aqui; ficam as notas, critérios e datas, que é o que sustenta
//   estatística agregada.
//
// O desvínculo da tentativa (`user_id` → NULL) é feito pelo próprio banco
// quando a conta é removida, via `on delete set null`
// (migration 20260912030000).
export async function purgeUserRecordings(params: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  dryRun?: boolean;
}): Promise<UserDataReport> {
  const { admin, userId, dryRun = true } = params;
  const report: UserDataReport = { dryRun, storageObjects: 0, responsesCleared: 0, errors: [] };

  for (const { track, table } of TRACKS) {
    // As gravações do usuário são todas as respostas das tentativas dele —
    // resolvido pelo banco (o caminho no Storage não é fonte de verdade).
    const { data, error } = await admin
      .from(table)
      .select("id, audio_path, simulation_attempts!inner(user_id)")
      .eq("simulation_attempts.user_id", userId);

    if (error) {
      report.errors.push(`${track}: falha ao listar respostas (${error.message})`);
      continue;
    }

    const rows = (data ?? []) as unknown as { id: string; audio_path: string | null }[];
    const paths = rows.map((r) => r.audio_path).filter((p): p is string => Boolean(p));
    report.storageObjects += paths.length;
    report.responsesCleared += rows.length;
    if (dryRun || rows.length === 0) continue;

    if (paths.length > 0) {
      const { error: storageError } = await admin.storage.from(recordingBucket(track)).remove(paths);
      if (storageError) {
        report.errors.push(`${track}: falha ao remover gravações (${storageError.message})`);
        continue;
      }
    }

    const { error: clearError } = await admin
      .from(table)
      .update({ audio_path: null, transcript: null, ai_feedback: null })
      .in(
        "id",
        rows.map((r) => r.id),
      );
    if (clearError) {
      report.errors.push(`${track}: falha ao limpar conteúdo de fala (${clearError.message})`);
    }
  }

  return report;
}
