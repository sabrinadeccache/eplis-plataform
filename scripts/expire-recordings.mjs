// Processo de expiração de gravações — Milestone 3.2 do plano de correção
// (ver docs/project-status.md). Prazos definidos pela Sabrina: practice 30
// dias, official 180 dias (`expires_at`, migration 20260912020000).
// Transcrição/feedback/notas NÃO são apagados — só o áudio.
//
// Espelha a lógica de src/lib/simulations/retention.ts (`expireRecordings`)
// — este script existe separado porque `scripts/*.mjs` roda em Node puro,
// sem os path aliases (`@/`) do TypeScript do app (ver outros scripts que
// usam `@supabase/supabase-js` direto, ex. dev-wipe-all-users.mjs).
//
// DRY-RUN POR PADRÃO: só lista o que venceria e conta, não apaga nada — é
// assim que o plano de correção pede pra retenção ser "verificável sem
// apagar manualmente dados de produção". Passe `--apply` pra de fato
// remover do Storage e zerar `audio_path`.
//
// **Achado da revisão (2026-09-12), corrigido aqui:**
// 1. Pagina de verdade — sem isso, um backlog grande de gravações vencidas
//    só era processado parcialmente (o limite da consulta cortava o resto
//    silenciosamente).
// 2. O caminho apagado no Storage é a UNIÃO do `audio_path` gravado (cobre
//    formato legado) com o caminho DERIVADO DOS IDS (cobre a linha cujo
//    upload terminou mas a escrita de `audio_path` falhou) — a versão
//    anterior usava só os IDs e perdia gravação legada (achado da 2ª
//    rodada de revisão: remover um caminho inexistente não dá erro, então
//    o código achava que tinha limpado sem ter tocado no objeto real).
// 3. Varredura extra pra linha com `audio_path` NULO e `processing_status
//    = 'error'` mais velha que o prazo mais curto de retenção — cobre o
//    caso em que o upload nunca chegou a gravar `audio_path` (por isso
//    nunca aparece no filtro principal, que exige `audio_path is not
//    null`) e a conta nunca foi excluída (único outro caminho, 100% por
//    ID, que alcançaria esse objeto).
//
// Uso:
//   node scripts/expire-recordings.mjs           # dry-run (não apaga nada)
//   node scripts/expire-recordings.mjs --apply   # apaga de verdade
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    env[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return env;
}

const TRACKS = [
  { table: "phase2_responses", bucket: "phase2-recordings" },
  { table: "pilot_responses", bucket: "pilot-recordings" },
];

const BATCH_SIZE = 500;
const MAX_BATCHES = 50;
const PRACTICE_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function buildPath(userId, attemptId, responseId) {
  return `${userId ?? "anon"}/${attemptId}/${responseId}`;
}

function attemptUserId(row) {
  const attempt = Array.isArray(row.simulation_attempts) ? row.simulation_attempts[0] : row.simulation_attempts;
  return attempt?.user_id ?? null;
}

function candidatePaths(row) {
  const deterministic = buildPath(attemptUserId(row), row.simulation_attempt_id, row.id);
  return row.audio_path && row.audio_path !== deterministic ? [row.audio_path, deterministic] : [deterministic];
}

async function sweepOrphanedUploads(supabase, { table, bucket }, cutoffIso, apply) {
  const { data, error } = await supabase
    .from(table)
    .select("id, simulation_attempt_id, simulation_attempts(user_id)")
    .is("audio_path", null)
    .eq("processing_status", "error")
    .lte("created_at", cutoffIso)
    .limit(500);
  if (error) throw new Error(`${table} (varredura de órfãos): ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0 || !apply) return rows.length;

  const paths = rows.map((r) => buildPath(attemptUserId(r), r.simulation_attempt_id, r.id));
  const { error: storageError } = await supabase.storage.from(bucket).remove(paths);
  if (storageError) throw new Error(`${table} (varredura, storage): ${storageError.message}`);
  return rows.length;
}

async function expireTrack(supabase, { table, bucket }, nowIso, apply) {
  let expired = 0;
  let storageDeleted = 0;
  let rowsCleared = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const range = apply ? [0, BATCH_SIZE - 1] : [batch * BATCH_SIZE, batch * BATCH_SIZE + BATCH_SIZE - 1];
    const { data, error } = await supabase
      .from(table)
      .select("id, simulation_attempt_id, audio_path, simulation_attempts(user_id)")
      .not("audio_path", "is", null)
      .lte("expires_at", nowIso)
      .order("id", { ascending: true })
      .range(range[0], range[1]);
    if (error) throw new Error(`${table}: ${error.message}`);

    const rows = data ?? [];
    if (rows.length === 0) break;
    expired += rows.length;

    if (!apply) {
      if (rows.length < BATCH_SIZE) break;
      continue;
    }

    const paths = rows.flatMap(candidatePaths);
    const { error: storageError } = await supabase.storage.from(bucket).remove(paths);
    if (storageError) throw new Error(`${table} (storage): ${storageError.message}`);
    storageDeleted += paths.length;

    const { error: clearError } = await supabase.from(table).update({ audio_path: null }).in("id", rows.map((r) => r.id));
    if (clearError) throw new Error(`${table} (clear): ${clearError.message}`);
    rowsCleared += rows.length;

    if (rows.length < BATCH_SIZE) break;
  }

  const cutoffIso = new Date(Date.now() - PRACTICE_RETENTION_DAYS * DAY_MS).toISOString();
  const orphansSwept = await sweepOrphanedUploads(supabase, { table, bucket }, cutoffIso, apply);

  return { expired, storageDeleted, rowsCleared, orphansSwept };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(apply ? "Aplicando (vai apagar de verdade)…" : "Dry-run (nada será apagado — use --apply pra aplicar)…");

  const nowIso = new Date().toISOString();
  for (const track of TRACKS) {
    const result = await expireTrack(supabase, track, nowIso, apply);
    console.log(
      `  ${track.table}: ${result.expired} vencida(s)` +
        (apply ? `, ${result.storageDeleted} removida(s) do storage, ${result.rowsCleared} linha(s) limpa(s)` : "") +
        `, ${result.orphansSwept} órfã(s) da varredura` +
        (apply ? " removida(s)" : " (dry-run)"),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
