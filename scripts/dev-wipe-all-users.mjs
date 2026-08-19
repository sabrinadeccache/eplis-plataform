// Utilitário de DEV: apaga TODOS os usuários (Supabase Auth + `public.users`,
// que cascade-deleta simulation_attempts/phase1_answers/phase2_responses/
// simulation_feedbacks, ver FKs em supabase/migrations/20260727000000_init_schema.sql)
// e os objetos de Storage por usuário (`avatars`) e por tentativa
// (`phase2-recordings`). NÃO mexe em conteúdo (phase1_questions, phase1_audios,
// phase2_prompts, phase2-images) — só dado de usuário/teste. Uso:
// `node scripts/dev-wipe-all-users.mjs`.
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

async function wipeStorageBucket(supabase, bucket) {
  const { data: folders, error } = await supabase.storage.from(bucket).list();
  if (error) throw error;
  let removed = 0;
  for (const folder of folders ?? []) {
    const { data: files } = await supabase.storage.from(bucket).list(folder.name);
    const paths = (files ?? []).map((f) => `${folder.name}/${f.name}`);
    if (paths.length === 0) continue;
    const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
    if (removeError) throw removeError;
    removed += paths.length;
  }
  return removed;
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let deletedUsers = 0;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw error;
    if (!data.users.length) break;
    for (const user of data.users) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
      if (deleteError) throw deleteError;
      deletedUsers += 1;
    }
  }

  const removedAvatars = await wipeStorageBucket(supabase, "avatars");
  const removedRecordings = await wipeStorageBucket(supabase, "phase2-recordings");

  console.log(
    `Apagados: ${deletedUsers} usuários (Auth + public.users, cascade em tentativas/respostas/feedbacks), ` +
      `${removedAvatars} arquivos em avatars, ${removedRecordings} arquivos em phase2-recordings.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
