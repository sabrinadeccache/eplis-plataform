// Dry-run por padrão. Ver docs/m3-privacy-handoff.md antes de --apply.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expireRecordings } from "../src/lib/simulations/retention-core.mjs";

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
  const report = await expireRecordings({ admin, dryRun });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
