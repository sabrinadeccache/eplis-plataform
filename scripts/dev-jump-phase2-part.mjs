// Utilitário de DEV: pula uma tentativa da Fase 2 (`simulation_attempts`) já
// em andamento direto pro início de uma parte específica, sem precisar
// responder as partes anteriores de novo — útil pra testar manualmente só um
// pedaço do fluxo (ex.: Parte 4) depois de já ter validado o resto.
// Reaproveita a tentativa in_progress mais recente do usuário; cria uma nova
// via INSERT se não houver nenhuma. Uso:
// `node scripts/dev-jump-phase2-part.mjs <email> <part1|part2|part3|part4>`.
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

const PART_INTRO_STATE = {
  part1: "PART_1_INTRO",
  part2: "PART_2_INTRO",
  part3: "PART_3_INTRO",
  part4: "PART_4_INTRO",
};

async function main() {
  const [, , email, part] = process.argv;
  if (!email || !PART_INTRO_STATE[part]) {
    console.error("Uso: node scripts/dev-jump-phase2-part.mjs <email> <part1|part2|part3|part4>");
    process.exit(1);
  }

  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const { rows: userRows } = await client.query(`select id from public.users where email = $1`, [email]);
  if (userRows.length === 0) throw new Error(`Usuário não encontrado: ${email}`);
  const userId = userRows[0].id;

  const { rows: attemptRows } = await client.query(
    `select id from public.simulation_attempts
     where user_id = $1 and phase = 'phase2' and status = 'in_progress'
     order by started_at desc limit 1`,
    [userId],
  );

  let attemptId;
  if (attemptRows.length > 0) {
    attemptId = attemptRows[0].id;
  } else {
    const { rows: inserted } = await client.query(
      `insert into public.simulation_attempts
         (user_id, phase, mode, status, current_part, current_item_index, current_state)
       values ($1, 'phase2', 'practice', 'in_progress', $2, 0, $3)
       returning id`,
      [userId, part, PART_INTRO_STATE[part]],
    );
    attemptId = inserted[0].id;
    console.log(`Nenhuma tentativa em andamento — criada uma nova: ${attemptId}`);
  }

  await client.query(
    `update public.simulation_attempts
       set current_part = $1, current_item_index = 0, current_state = $2
     where id = $3`,
    [part, PART_INTRO_STATE[part], attemptId],
  );

  console.log(`Tentativa ${attemptId} pulada pra ${part}.`);
  console.log(`Abra: http://localhost:3000/fase2/entrevista/${attemptId}`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
