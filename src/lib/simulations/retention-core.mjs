// Núcleo único usado pelo cron, testes e scripts Node. Sem aliases/segredos.
// Contrato operacional e recuperação de workers: docs/m3-privacy-handoff.md.
export const RETENTION_DAYS = { practice: 30, official: 180 };
const DAY_MS = 86400000;
const TRACKS = [{ track: "phase2", table: "phase2_responses" }, { track: "pilot", table: "pilot_responses" }];
const PAGE = 500;
const chunks = (rows, size) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
const bucket = (track) => `${track === "phase2" ? "phase2" : "pilot"}-recordings`;
export function recordingExpiresAt(mode, from = new Date()) {
  return new Date(from.getTime() + RETENTION_DAYS[mode] * DAY_MS).toISOString();
}
function owner(row) {
  const attempt = Array.isArray(row.simulation_attempts) ? row.simulation_attempts[0] : row.simulation_attempts;
  return attempt?.user_id ?? null;
}
function paths(row, userId) {
  // audio_path é legado e já foi gravável pelo client. Não permitir que um
  // ponteiro envenenado apague objeto de outra tentativa no bucket.
  const result = [];
  if (row.audio_path) {
    const parts = row.audio_path.split("/");
    const clean = parts.every((part) => part && part !== "." && part !== ".." && !part.includes("\0"));
    const legacy = parts.length === 2 && parts[0] === row.simulation_attempt_id;
    const current = parts.length === 3 && parts[1] === row.simulation_attempt_id && (!userId || parts[0] === userId);
    if (!clean || (!legacy && !current)) throw new Error("audio_path fora do namespace da tentativa; exige reconciliação.");
    result.push(row.audio_path);
  }
  if (userId) result.push(`${userId}/${row.simulation_attempt_id}/${row.id}`);
  if (!result.length) throw new Error("Gravação sem dono nem caminho: exige reconciliação, não marcar como limpa.");
  return [...new Set(result)];
}
async function remove(admin, track, candidates) {
  for (const batch of chunks([...new Set(candidates)], 500)) {
    const { error } = await admin.storage.from(bucket(track)).remove(batch);
    if (error) throw new Error(`falha no Storage (${error.message})`);
  }
}
async function clearRows(admin, table, rows, payload) {
  for (const batch of chunks(rows, 100)) {
    const { error } = await admin.from(table).update(payload).in("id", batch.map((r) => r.id));
    if (error) throw new Error(`falha na persistência (${error.message})`);
  }
}
export async function expireRecordings({ admin, now = new Date(), dryRun = true, batchSize = 500, maxBatches = 50 }) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500 || !Number.isInteger(maxBatches) || maxBatches < 1) throw new Error("Lote inválido");
  const report = { dryRun, byTrack: { phase2: { expired: 0, storageDeleted: 0, rowsCleared: 0, orphansSwept: 0 }, pilot: { expired: 0, storageDeleted: 0, rowsCleared: 0, orphansSwept: 0 } }, errors: [] };
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  for (const { track, table } of TRACKS) {
    for (const orphan of [false, true]) {
      let cursor = null;
      for (let page = 0; page < maxBatches; page++) {
        let q = admin.from(table).select("id, simulation_attempt_id, audio_path, processing_status, started_at, simulation_attempts(user_id)").order("id", { ascending: true }).limit(batchSize);
        if (cursor) q = q.gt("id", cursor);
        q = orphan
          ? q.is("audio_path", null).is("recording_purged_at", null).in("processing_status", ["error", "transcribing", "analyzing"])
              .or(`started_at.lte.${cutoff},and(started_at.is.null,created_at.lte.${cutoff})`)
          : q.not("audio_path", "is", null).lte("expires_at", nowIso);
        const { data, error } = await q;
        if (error) { report.errors.push(`${track}: falha ao listar (${error.message})`); break; }
        const rows = data ?? [];
        if (!rows.length) break;
        cursor = rows.at(-1).id;
        if (dryRun) {
          report.byTrack[track][orphan ? "orphansSwept" : "expired"] += rows.length;
        } else {
          try {
            // Um RPC por página revalida cada linha sob lock. Retry que ganhou
            // renova started_at; cleanup que ganhou fecha o slot para upload.
            const { data: claims, error: claimError } = await admin.rpc("claim_recording_cleanup_batch", {
              p_track: track,
              p_candidates: rows.map((row) => ({ id: row.id, audio_path: row.audio_path })),
              p_now: nowIso,
              p_orphan: orphan,
            });
            if (claimError) throw new Error(claimError.message);
            const claimedIds = new Set((claims ?? []).filter((claim) => claim.claimed).map((claim) => claim.response_id));
            const uploadPending = (claims ?? []).filter((claim) => claim.upload_pending).length;
            if (uploadPending) report.errors.push(`${track}: ${uploadPending} upload(s) não finalizado(s); reconciliação necessária.`);
            const claimedRows = rows.filter((row) => claimedIds.has(row.id));
            if (claimedRows.length) {
              const candidates = claimedRows.flatMap((row) => paths(row, owner(row)));
              await remove(admin, track, candidates);
              await clearRows(admin, table, claimedRows, { audio_path: null, audio_url: null, recording_purged_at: nowIso });
              if (orphan) report.byTrack[track].orphansSwept += claimedRows.length;
              else {
                report.byTrack[track].expired += claimedRows.length;
                report.byTrack[track].rowsCleared += claimedRows.length;
              }
              report.byTrack[track].storageDeleted += new Set(candidates).size;
            }
          } catch (e) { report.errors.push(`${track}: ${e.message}`); }
        }
        if (rows.length < batchSize) break;
        if (page === maxBatches - 1) report.errors.push(`${track}: limite de lotes atingido; repetir para drenar backlog.`);
      }
    }
  }
  return report;
}
async function allRows(query) {
  const rows = [];
  for (let page = 0; ; page++) {
    const { data, error } = await query().order("id", { ascending: true }).range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}
export async function purgeUserRecordings({ admin, userId, dryRun = true }) {
  const report = { dryRun, storageObjectsRemoved: 0, responsesCleared: 0, feedbacksCleared: 0, accountBlocked: false, errors: [] };
  try {
    if (!dryRun) {
      const { data: drained, error } = await admin.rpc("request_privacy_deletion", { p_user_id: userId });
      if (error) throw new Error(`falha ao bloquear a conta (${error.message})`);
      report.accountBlocked = true;
      if (drained !== true) throw new Error("Exclusão pendente: upload em andamento/não finalizado. Repetir após conclusão; não apagar Auth.");
    }
    const attempts = await allRows(() => admin.from("simulation_attempts").select("id").eq("user_id", userId));
    for (const ids of chunks(attempts.map((r) => r.id), 100)) {
      for (const { track, table } of TRACKS) {
        const rows = await allRows(() => admin.from(table).select("id, simulation_attempt_id, audio_path").in("simulation_attempt_id", ids));
        if (!dryRun) {
          const candidates = rows.flatMap((r) => paths(r, userId));
          await remove(admin, track, candidates);
          report.storageObjectsRemoved += candidates.length;
          await clearRows(admin, table, rows, { audio_path: null, audio_url: null, transcript: null, ai_feedback: null });
        }
        report.responsesCleared += rows.length;
      }
      const feedbacks = await allRows(() => admin.from("simulation_feedbacks").select("id").in("simulation_attempt_id", ids));
      if (!dryRun) await clearRows(admin, "simulation_feedbacks", feedbacks, { general_feedback: null });
      report.feedbacksCleared += feedbacks.length;
    }
  } catch (e) { report.errors.push(e.message); }
  return report;
}
