// Utilitário de DEV: pula uma tentativa da Fase 2 (`simulation_attempts`) já
// em andamento direto pro início de uma parte específica, sem precisar
// responder as partes anteriores de novo — útil pra testar manualmente só um
// pedaço do fluxo (ex.: Parte 4) depois de já ter validado o resto.
// Reaproveita a tentativa in_progress mais recente do usuário; cria uma nova
// via INSERT se não houver nenhuma. Uso:
// `node scripts/dev-jump-phase2-part.mjs <email> <part1|part2|part3|part4> [itemIndex]`.
// `itemIndex` (opcional, default 0) é útil pra testar a TRANSIÇÃO entre
// partes sem responder a parte toda de novo — ex.: pra retestar part3 ->
// part4, pule pro último item da part3 (índice 3, já que PART_SIZES.part3
// é 4) e responda só esse item.
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

// Estado usado quando itemIndex > 0 — mesmos labels de src/services/simulations/phase2/state-machine.ts.
const PART_ITEM_STATE = {
  part1: "PART_1_QUESTION",
  part2: "PART_2_SCENARIO",
  part3: "PART_3_QUESTION",
  part4: "PART_4_ITEM",
};

async function main() {
  const [, , email, part, itemIndexArg] = process.argv;
  if (!email || !PART_INTRO_STATE[part]) {
    console.error(
      "Uso: node scripts/dev-jump-phase2-part.mjs <email> <part1|part2|part3|part4> [itemIndex]",
    );
    process.exit(1);
  }
  const itemIndex = itemIndexArg !== undefined ? Number(itemIndexArg) : 0;
  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    console.error("itemIndex precisa ser um inteiro >= 0.");
    process.exit(1);
  }
  const itemState = itemIndex === 0 ? PART_INTRO_STATE[part] : PART_ITEM_STATE[part];

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
       values ($1, 'phase2', 'practice', 'in_progress', $2, $3, $4)
       returning id`,
      [userId, part, itemIndex, itemState],
    );
    attemptId = inserted[0].id;
    console.log(`Nenhuma tentativa em andamento — criada uma nova: ${attemptId}`);
  }

  await client.query(
    `update public.simulation_attempts
       set current_part = $1, current_item_index = $2, current_state = $3
     where id = $4`,
    [part, itemIndex, itemState, attemptId],
  );

  console.log(`Tentativa ${attemptId} pulada pra ${part}, item ${itemIndex}.`);
  console.log(`Abra: http://localhost:3000/fase2/entrevista/${attemptId}`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
