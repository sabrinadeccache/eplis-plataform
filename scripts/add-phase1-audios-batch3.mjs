// Adiciona os 130 novos áudios da Fase 1 (audio060–audio189, cortes de
// comunicações reais de ATC) + suas perguntas, a partir do mapa oficial da
// Sabrina (`Material Didático/ATC/Phase 1 - Audios/mapa_questões.xlsx`,
// aba "FASE 1"). Os dados extraídos e normalizados ficam em
// `scripts/data/phase1-batch3.json` (título = "SITUAÇÃO — ITEM", com sufixo
// "(2)", "(3)"… quando o mesmo voo aparece em vários cortes; categoria e
// dificuldade inferidas — metadados descritivos, não entram na seleção do
// simulado; duração via `afinfo`).
//
// Aditivo — não mexe nos 43 áudios / 60 perguntas já existentes (audio01–10 +
// lote v*). UPSERT por título (natural key estável): reexecutar só atualiza.
// As perguntas de cada áudio são reinseridas a cada rodada; o script recusa se
// alguma já tiver `phase1_answers` real apontando pra ela.
// Uso: `node scripts/add-phase1-audios-batch3.mjs`
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
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = env.SUPABASE_DB_URL;

const SOURCE_DIR =
  "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/ATC/Phase 1 - Audios";

const ITEMS = JSON.parse(
  readFileSync(new URL("./data/phase1-batch3.json", import.meta.url), "utf8"),
);

async function upload(path, buffer) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/phase1-audios/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload falhou (${res.status}): ${body.slice(0, 300)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/phase1-audios/${path}`;
}

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  let audiosInserted = 0;
  let audiosUpdated = 0;
  let questionsInserted = 0;

  for (const item of ITEMS) {
    const filePath = `${SOURCE_DIR}/${item.file}`;
    const buffer = readFileSync(filePath);
    const audioUrl = await upload(item.file, buffer);

    const existing = await db.query(
      `select id from public.phase1_audios where title = $1`,
      [item.title],
    );

    let audioId;
    if (existing.rows.length > 0) {
      audioId = existing.rows[0].id;
      await db.query(
        `update public.phase1_audios
           set audio_url = $1, transcript = $2, difficulty = $3, category = $4,
               accent = $5, duration_seconds = $6, is_active = true
         where id = $7`,
        [audioUrl, item.transcript, item.difficulty, item.category, item.accent, item.durationSeconds, audioId],
      );
      audiosUpdated++;
    } else {
      const result = await db.query(
        `insert into public.phase1_audios
          (title, audio_url, transcript, difficulty, category, accent, duration_seconds, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, true)
         returning id`,
        [item.title, audioUrl, item.transcript, item.difficulty, item.category, item.accent, item.durationSeconds],
      );
      audioId = result.rows[0].id;
      audiosInserted++;
    }

    const answered = await db.query(
      `select 1
         from public.phase1_answers a
         join public.phase1_questions q on q.id = a.question_id
        where q.audio_id = $1
        limit 1`,
      [audioId],
    );
    if (answered.rows.length > 0) {
      throw new Error(
        `Áudio "${item.title}" já tem respostas reais — não dá pra reinserir as perguntas com segurança. Abortando.`,
      );
    }

    await db.query(`delete from public.phase1_questions where audio_id = $1`, [audioId]);
    for (const q of item.questions) {
      await db.query(
        `insert into public.phase1_questions
          (audio_id, prompt, option_a, option_b, option_c, correct_option, is_active)
         values ($1, $2, $3, $4, $5, $6, true)`,
        [audioId, q.prompt, q.optionA, q.optionB, q.optionC, q.correct],
      );
      questionsInserted++;
    }

    console.log(
      `[${item.file}] ${item.title} — ${item.durationSeconds}s, ${item.difficulty}, ${item.questions.length} pergunta(s)`,
    );
  }

  console.log(
    `\nÁudios: ${audiosInserted} inseridos, ${audiosUpdated} atualizados. Perguntas: ${questionsInserted}.`,
  );

  const totals = await db.query(
    `select
       (select count(*) from public.phase1_audios where is_active) as audios,
       (select count(*) from public.phase1_questions where is_active) as questions`,
  );
  console.log(
    `Pool total ativo: ${totals.rows[0].audios} áudios / ${totals.rows[0].questions} perguntas.`,
  );

  await db.end();
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
