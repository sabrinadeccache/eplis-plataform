// Dry-run por padrão. Ver docs/m3-privacy-handoff.md antes de --apply.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { purgeUserRecordings } from "../src/lib/simulations/retention-core.mjs";

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

async function main() {
  const env = loadEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const dryRun = !process.argv.includes("--apply");
  const email = process.argv[2];
  if (!email || email.startsWith("--")) throw new Error("Uso: node scripts/delete-user-data.mjs <email> [--apply]");
  const { data: user, error } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (error || !user) throw new Error("Não foi possível encontrar a conta.");
  const report = await purgeUserRecordings({ admin, userId: user.id, dryRun });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) { process.exitCode = 1; return; }
  if (!dryRun) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
    console.log("Conta removida; conteúdo de fala limpo e resultados desvinculados.");
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
