// Exclusão de conta — Milestone 3.2 do plano de correção (ver
// docs/project-status.md). Decisão da Sabrina: **apaga o áudio, mantém o
// resultado ANONIMIZADO** — a plataforma não perde histórico de uso
// (estatística agregada), mas o titular deixa de ser identificável.
//
// Ordem importa: o Storage não participa de cascade do Postgres, então as
// gravações (e a transcrição/feedback, que são conteúdo de fala — dado
// pessoal) precisam ser limpas ANTES de apagar a conta. Depois, apagar a
// conta em `public.users`/Auth desvincula as tentativas automaticamente
// (`simulation_attempts.user_id` → NULL, `on delete set null`, migration
// 20260912030000) — elas sobrevivem anônimas.
//
// DRY-RUN POR PADRÃO: só lista o que seria apagado. Passe `--apply` pra
// executar de verdade. Isto é uma operação IRREVERSÍVEL (a voz e o
// conteúdo de fala do titular são removidos de vez) — pensado pra rodar
// mediante pedido do titular pelo canal administrativo (M3.3), não em
// lote.
//
// Uso:
//   node scripts/delete-user-data.mjs <email>             # dry-run
//   node scripts/delete-user-data.mjs <email> --apply     # aplica de verdade
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

async function purgeTrack(supabase, { table, bucket }, userId, apply) {
  const { data, error } = await supabase
    .from(table)
    .select("id, audio_path, simulation_attempts!inner(user_id)")
    .eq("simulation_attempts.user_id", userId);
  if (error) throw new Error(`${table}: ${error.message}`);

  const rows = data ?? [];
  const paths = rows.map((r) => r.audio_path).filter(Boolean);
  if (rows.length === 0 || !apply) {
    return { responses: rows.length, storageObjects: paths.length };
  }

  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(bucket).remove(paths);
    if (storageError) throw new Error(`${table} (storage): ${storageError.message}`);
  }

  const { error: clearError } = await supabase
    .from(table)
    .update({ audio_path: null, transcript: null, ai_feedback: null })
    .in("id", rows.map((r) => r.id));
  if (clearError) throw new Error(`${table} (clear): ${clearError.message}`);

  return { responses: rows.length, storageObjects: paths.length };
}

async function main() {
  const email = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!email) {
    console.error("Uso: node scripts/delete-user-data.mjs <email> [--apply]");
    process.exit(1);
  }

  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("id, email, role, status")
    .eq("email", email)
    .maybeSingle();
  if (userError) throw userError;
  if (!userRow) {
    console.error(`Nenhum usuário com o e-mail ${email}.`);
    process.exit(1);
  }

  console.log(apply ? "Aplicando (irreversível)…" : "Dry-run (nada será apagado — use --apply pra aplicar)…");
  console.log(`Usuário: ${userRow.id} (${userRow.email}, role=${userRow.role})`);

  for (const track of TRACKS) {
    const result = await purgeTrack(supabase, track, userRow.id, apply);
    console.log(`  ${track.table}: ${result.responses} resposta(s), ${result.storageObjects} gravação(ões)`);
  }

  if (!apply) {
    console.log("\nDry-run concluído. Rode com --apply pra limpar o conteúdo de fala e então apagar a conta.");
    return;
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userRow.id);
  if (deleteError) throw deleteError;
  console.log(
    `\nConta removida (Auth + public.users). As tentativas ficam anônimas ` +
      `(simulation_attempts.user_id = NULL) — histórico de uso preservado, titular não identificável.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
