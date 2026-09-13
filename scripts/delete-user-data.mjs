// Exclusão de conta — Milestone 3.2 do plano de correção (ver
// docs/project-status.md). Decisão da Sabrina: **apaga o áudio, mantém o
// resultado ANONIMIZADO** — a plataforma não perde histórico de uso
// (estatística agregada), mas o titular deixa de ser identificável.
//
// Espelha src/lib/simulations/retention.ts (`purgeUserRecordings`) — ver lá
// o motivo de cada passo. Resumo do que muda em relação à 1ª versão deste
// script (achados da revisão de 2026-09-12):
//
// 1. Bloqueia a conta (`status = 'blocked'`) ANTES de tocar em qualquer
//    dado — sem isso, nada impedia um envio novo durante a limpeza (a
//    conta continuava `active` até o `deleteUser` final). `authorize()`
//    (M1) já rejeita toda ação de conta não-`active`.
// 2. Pagina de verdade (tentativas, respostas, feedbacks) — a versão
//    anterior só limpava até o limite implícito de uma consulta.
// 3. O caminho apagado no Storage é DERIVADO DOS IDS, não da coluna
//    `audio_path` — cobre a linha cujo upload terminou mas nunca chegou a
//    gravar `audio_path`.
// 4. Também zera `audio_url` (legado) e `simulation_feedbacks.general_feedback`
//    (conteúdo derivado da fala do titular, ligado à tentativa mesmo depois
//    de anonimizada).
//
// DRY-RUN POR PADRÃO. Passe `--apply` pra executar de verdade — é
// IRREVERSÍVEL (a voz e o conteúdo de fala do titular são removidos de
// vez). Pensado pra rodar mediante pedido do titular pelo canal
// administrativo (M3.3), não em lote.
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

const PAGE_SIZE = 500;
const ATTEMPT_CHUNK = 200;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function buildPath(userId, attemptId, responseId) {
  return `${userId}/${attemptId}/${responseId}`;
}

async function fetchAllAttemptIds(supabase, userId) {
  const ids = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from("simulation_attempts")
      .select("id")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(`simulation_attempts: ${error.message}`);
    ids.push(...data.map((r) => r.id));
    if (data.length < PAGE_SIZE) break;
  }
  return ids;
}

async function purgeTrack(supabase, { table, bucket }, userId, attemptIds, apply) {
  let responses = 0;
  let storageObjects = 0;

  for (const idsChunk of chunk(attemptIds, ATTEMPT_CHUNK)) {
    const { data, error } = await supabase.from(table).select("id, simulation_attempt_id, audio_path").in("simulation_attempt_id", idsChunk);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) continue;
    responses += rows.length;
    if (!apply) continue;

    const paths = rows.map((r) => buildPath(userId, r.simulation_attempt_id, r.id));
    const { error: storageError } = await supabase.storage.from(bucket).remove(paths);
    if (storageError) throw new Error(`${table} (storage): ${storageError.message}`);
    storageObjects += paths.length;

    const { error: clearError } = await supabase
      .from(table)
      .update({ audio_path: null, audio_url: null, transcript: null, ai_feedback: null })
      .in("id", rows.map((r) => r.id));
    if (clearError) throw new Error(`${table} (clear): ${clearError.message}`);
  }

  return { responses, storageObjects };
}

async function clearFeedbacks(supabase, attemptIds, apply) {
  let cleared = 0;
  if (!apply) {
    for (const idsChunk of chunk(attemptIds, ATTEMPT_CHUNK)) {
      const { data, error } = await supabase.from("simulation_feedbacks").select("id").in("simulation_attempt_id", idsChunk);
      if (error) throw new Error(`simulation_feedbacks: ${error.message}`);
      cleared += (data ?? []).length;
    }
    return cleared;
  }
  for (const idsChunk of chunk(attemptIds, ATTEMPT_CHUNK)) {
    const { data, error } = await supabase.from("simulation_feedbacks").select("id").in("simulation_attempt_id", idsChunk);
    if (error) throw new Error(`simulation_feedbacks: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) continue;
    const { error: clearError } = await supabase
      .from("simulation_feedbacks")
      .update({ general_feedback: null })
      .in("id", rows.map((r) => r.id));
    if (clearError) throw new Error(`simulation_feedbacks (clear): ${clearError.message}`);
    cleared += rows.length;
  }
  return cleared;
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

  if (apply) {
    // Bloqueia a conta ANTES de tocar em qualquer dado — impede que uma
    // submissão em andamento ou nova crie gravação durante a limpeza
    // (achado da revisão: authorize() já rejeita conta não-`active`, M1).
    const { error: blockError } = await supabase.from("users").update({ status: "blocked" }).eq("id", userRow.id);
    if (blockError) throw new Error(`Falha ao bloquear a conta antes da limpeza: ${blockError.message}`);
    console.log("Conta bloqueada (status=blocked) — nenhuma submissão nova passa a partir daqui.");
  }

  const attemptIds = await fetchAllAttemptIds(supabase, userRow.id);
  console.log(`Tentativas do usuário: ${attemptIds.length}`);

  for (const track of TRACKS) {
    const result = await purgeTrack(supabase, track, userRow.id, attemptIds, apply);
    console.log(`  ${track.table}: ${result.responses} resposta(s), ${result.storageObjects} gravação(ões) removida(s)`);
  }

  const feedbacksCleared = await clearFeedbacks(supabase, attemptIds, apply);
  console.log(`  simulation_feedbacks: ${feedbacksCleared} relatório(s) com general_feedback limpo`);

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
