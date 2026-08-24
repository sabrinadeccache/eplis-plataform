// Utilitário de DEV: mesmo padrão de scripts/dev-jump-phase2-part.mjs, mas
// pra trilha do piloto/SDEA — pula uma tentativa (`phase = 'pilot_interview'`)
// direto pro início de uma parte específica. Uso:
// `node scripts/dev-jump-sdea-part.mjs <email> <part1|part2|part3|part4> [itemIndex] [mode]`.
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
  part1: "PILOT_PART_1_INTRO",
  part2: "PILOT_PART_2_INTRO",
  part3: "PILOT_PART_3_INTRO",
  part4: "PILOT_PART_4_INTRO",
};

const PART_ITEM_STATE = {
  part1: "PILOT_PART_1_QUESTION",
  part2: "PILOT_PART_2_SITUATION",
  part3: "PILOT_PART_3_SITUATION",
  part4: "PILOT_PART_4_ITEM",
};

async function main() {
  const [, , email, part, itemIndexArg, modeArg] = process.argv;
  if (!email || !PART_INTRO_STATE[part]) {
    console.error(
      "Uso: node scripts/dev-jump-sdea-part.mjs <email> <part1|part2|part3|part4> [itemIndex] [practice|official]",
    );
    process.exit(1);
  }
  const itemIndex = itemIndexArg !== undefined ? Number(itemIndexArg) : 0;
  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    console.error("itemIndex precisa ser um inteiro >= 0.");
    process.exit(1);
  }
  if (modeArg !== undefined && modeArg !== "practice" && modeArg !== "official") {
    console.error('mode precisa ser "practice" ou "official".');
    process.exit(1);
  }
  const itemState = itemIndex === 0 ? PART_INTRO_STATE[part] : PART_ITEM_STATE[part];

  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const { rows: userRows } = await client.query(`select id from public.users where email = $1`, [email]);
  if (userRows.length === 0) throw new Error(`Usuário não encontrado: ${email}`);
  const userId = userRows[0].id;

  const modeFilter = modeArg ? `and mode = '${modeArg}'` : "";
  const { rows: attemptRows } = await client.query(
    `select id, mode from public.simulation_attempts
     where user_id = $1 and phase = 'pilot_interview' and status = 'in_progress' ${modeFilter}
     order by started_at desc limit 1`,
    [userId],
  );

  let attemptId;
  let attemptMode;
  if (attemptRows.length > 0) {
    attemptId = attemptRows[0].id;
    attemptMode = attemptRows[0].mode;
  } else {
    attemptMode = modeArg ?? "practice";
    const { rows: inserted } = await client.query(
      `insert into public.simulation_attempts
         (user_id, phase, mode, status, current_part, current_item_index, current_state)
       values ($1, 'pilot_interview', $2, 'in_progress', $3, $4, $5)
       returning id`,
      [userId, attemptMode, part, itemIndex, itemState],
    );
    attemptId = inserted[0].id;
    console.log(`Nenhuma tentativa em andamento (modo ${attemptMode}) — criada uma nova: ${attemptId}`);
  }

  await client.query(
    `update public.simulation_attempts
       set current_part = $1, current_item_index = $2, current_state = $3
     where id = $4`,
    [part, itemIndex, itemState, attemptId],
  );

  console.log(`Tentativa ${attemptId} (modo ${attemptMode}) pulada pra ${part}, item ${itemIndex}.`);
  console.log(`Abra: http://localhost:3000/sdea/entrevista/${attemptId}`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
