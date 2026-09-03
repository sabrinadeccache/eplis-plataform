// Sobe as gravações reais da Parte 3 do SDEA (o diálogo piloto/controlador que o
// candidato só escuta) pro bucket público `pilot-prompt-audio` e grava
// `dialogue_audio_url` em `pilot_prompts`.
//
// Fonte: `Material Didático/.../Part 3/Audios/<basename>.mp3` — gravações reais de
// R/T (não precisam de efeito de rádio sintético). O mapa situação→arquivo vem da
// aba "PART III" de `Part 3/questions-map-part-3.xlsx`, coluna ÁUDIO, em ordem:
// a situação de `order_index` N usa `BASENAMES[N-1]` (conferido: a ordem da aba
// bate 1:1 com order_index no banco e com a ordem de `pilot-content-part234.mjs`).
//
// Objeto no Storage: `<prompt_id>/dialogue.mp3`. O runner toca 2x (fiel ao exame).
//
// Idempotente (`x-upsert` + update incondicional). `--dry-run` só lista.
// Rode DEPOIS de `scripts/seed-pilot-prompts.mjs`.
// Uso: `node scripts/upload-pilot-part3-audio.mjs [--dry-run]`
import { readFileSync, existsSync } from "node:fs";
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
const BUCKET = "pilot-prompt-audio";
const DRY_RUN = process.argv.includes("--dry-run");

const AUDIO_DIR =
  "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/Pilots/Material Didático/Part 3/Audios";

// coluna ÁUDIO da aba "PART III", em ordem (order_index 1..38).
const BASENAMES = [
  "audio01", "audio02", "audio03", "audio04", "audio05", "audio06", "audio07",
  "audio08", "audio09", "audio10", "v01b", "v01c", "v02a", "v02b", "v03a", "v04a",
  "v04b", "v04c", "v05a", "v06a", "v06b", "v06c", "v07c", "v07d", "v08a", "v08b",
  "v10a", "v10b", "v11a", "v11b", "v12b", "v12c", "v13a", "v13b", "v13c", "v14a",
  "v14b", "v14c",
];

async function uploadObject(objectPath, buffer) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
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
    throw new Error(`upload ${objectPath} falhou (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

async function main() {
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const { rows } = await client.query(
    `select id, order_index
       from public.pilot_prompts
      where is_active and part = 'part3' and aircraft_type = 'general'
      order by order_index`,
  );

  let done = 0;
  const problems = [];

  for (const row of rows) {
    const base = BASENAMES[row.order_index - 1];
    if (!base) {
      problems.push(`sem áudio mapeado pra order_index ${row.order_index}`);
      continue;
    }
    const src = `${AUDIO_DIR}/${base}.mp3`;
    if (!existsSync(src)) {
      problems.push(`arquivo não encontrado: ${src}`);
      continue;
    }
    const objectPath = `${row.id}/dialogue.mp3`;
    if (DRY_RUN) {
      console.log(`[dry-run] #${row.order_index} <- ${base}.mp3 -> ${objectPath}`);
      done++;
      continue;
    }
    const url = await uploadObject(objectPath, readFileSync(src));
    await client.query(`update public.pilot_prompts set dialogue_audio_url = $1 where id = $2`, [url, row.id]);
    done++;
    console.log(`OK #${row.order_index} (${base}) -> ${url}`);
  }

  await client.end();

  console.log(`\n${DRY_RUN ? "[dry-run] " : ""}${done} diálogo(s) ${DRY_RUN ? "seriam enviados" : "enviados"}.`);
  if (problems.length > 0) {
    console.log("Problemas:");
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
