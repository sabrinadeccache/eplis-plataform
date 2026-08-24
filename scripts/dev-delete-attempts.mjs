// Utilitário de DEV: apaga tentativas específicas da Fase 1/Fase 2 por id —
// contraparte de dev-seed-fase2-limit-test.mjs (e útil pra limpar qualquer
// outra tentativa fictícia pontual sem tocar no resto do banco). Respeita a
// FK de simulation_feedbacks/phase2_responses/phase1_answers antes de apagar
// a própria simulation_attempts.
// Uso: `node scripts/dev-delete-attempts.mjs <id1> [id2] [id3] ...`.
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

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Uso: node scripts/dev-delete-attempts.mjs <id1> [id2] [id3] ...");
    process.exit(1);
  }

  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const feedbacks = await client.query(
    `delete from public.simulation_feedbacks where simulation_attempt_id = any($1::uuid[])`,
    [ids],
  );
  const phase2Responses = await client.query(
    `delete from public.phase2_responses where simulation_attempt_id = any($1::uuid[])`,
    [ids],
  );
  const phase1Answers = await client.query(
    `delete from public.phase1_answers where simulation_attempt_id = any($1::uuid[])`,
    [ids],
  );
  const attempts = await client.query(
    `delete from public.simulation_attempts where id = any($1::uuid[])`,
    [ids],
  );

  console.log(
    `Apagado: ${feedbacks.rowCount} simulation_feedbacks, ${phase2Responses.rowCount} phase2_responses, ` +
      `${phase1Answers.rowCount} phase1_answers, ${attempts.rowCount} simulation_attempts.`,
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
