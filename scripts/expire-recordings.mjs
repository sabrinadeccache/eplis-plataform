// Processo de expiração de gravações — Milestone 3.2 do plano de correção
// (ver docs/project-status.md). Prazos definidos pela Sabrina: practice 30
// dias, official 180 dias (`expires_at`, migration 20260912020000).
// Transcrição/feedback/notas NÃO são apagados — só o áudio.
//
// DRY-RUN POR PADRÃO: só lista o que venceria e conta, não apaga nada — é
// assim que o plano de correção pede pra retenção ser "verificável sem
// apagar manualmente dados de produção". Passe `--apply` pra de fato
// remover do Storage e zerar `audio_path`.
//
// Idempotente: rodar de novo sem `--apply` (ou com) depois de já ter
// aplicado não reprocessa nada — a linha já não tem `audio_path`, sai da
// consulta.
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

async function expireTrack(supabase, { table, bucket }, apply) {
  const { data, error } = await supabase
    .from(table)
    .select("id, audio_path")
    .not("audio_path", "is", null)
    .lte("expires_at", new Date().toISOString())
    .limit(500);
  if (error) throw new Error(`${table}: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0 || !apply) {
    return { expired: rows.length, storageDeleted: 0, rowsCleared: 0 };
  }

  const { error: storageError } = await supabase.storage.from(bucket).remove(rows.map((r) => r.audio_path));
  if (storageError) throw new Error(`${table} (storage): ${storageError.message}`);

  const { error: clearError } = await supabase
    .from(table)
    .update({ audio_path: null })
    .in("id", rows.map((r) => r.id));
  if (clearError) throw new Error(`${table} (clear): ${clearError.message}`);

  return { expired: rows.length, storageDeleted: rows.length, rowsCleared: rows.length };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(apply ? "Aplicando (vai apagar de verdade)…" : "Dry-run (nada será apagado — use --apply pra aplicar)…");

  for (const track of TRACKS) {
    const result = await expireTrack(supabase, track, apply);
    console.log(
      `  ${track.table}: ${result.expired} vencida(s)` +
        (apply ? `, ${result.storageDeleted} removida(s) do storage, ${result.rowsCleared} linha(s) limpa(s)` : ""),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
