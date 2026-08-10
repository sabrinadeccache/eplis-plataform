// Utilitário de DEV: apaga TODAS as tentativas/respostas de teste da Fase 1 e
// da Fase 2 (simulation_attempts, phase1_answers, phase2_responses,
// simulation_feedbacks), pra deixar o banco limpo antes de uma nova rodada de
// testes. NÃO apaga usuários, conteúdo (phase1_questions/audios,
// phase2_prompts) nem objetos de Storage. Ordem de delete respeita as FKs
// (respostas/feedbacks antes das tentativas). Uso:
// `node scripts/dev-clean-test-data.mjs`.
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
  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const feedbacks = await client.query(`delete from public.simulation_feedbacks`);
  const phase2Responses = await client.query(`delete from public.phase2_responses`);
  const phase1Answers = await client.query(`delete from public.phase1_answers`);
  const attempts = await client.query(`delete from public.simulation_attempts`);

  console.log(
    `Limpo: ${feedbacks.rowCount} simulation_feedbacks, ${phase2Responses.rowCount} phase2_responses, ` +
      `${phase1Answers.rowCount} phase1_answers, ${attempts.rowCount} simulation_attempts.`,
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
