// Aplica um arquivo de migration único via conexão Postgres direta, já que não
// há Supabase CLI/MCP autorizado nesta máquina (ver docs/project-status.md).
// Uso: `node scripts/apply-migration.mjs supabase/migrations/<arquivo>.sql`
import { readFileSync } from "node:fs";
import { Client } from "pg";

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

const env = loadEnv();
const migrationPath = process.argv[2];
if (!migrationPath) {
  console.error("Uso: node scripts/apply-migration.mjs <caminho-do-arquivo.sql>");
  process.exit(1);
}

const client = new Client({ connectionString: env.SUPABASE_DB_URL });
await client.connect();
const sql = readFileSync(migrationPath, "utf8");
await client.query(sql);
console.log(`Migration aplicada: ${migrationPath}`);
await client.end();
