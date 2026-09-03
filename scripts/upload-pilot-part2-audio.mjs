// Sobe as gravações reais da Parte 2 do SDEA (as duas falas do controlador de
// cada situação — ÁUDIO 1 e ÁUDIO 2) pro bucket público `pilot-prompt-audio` e
// grava as URLs em `pilot_prompts` (`atc_audio_url` = a01, `atc_followup_audio_url`
// = a02).
//
// Fonte (gravações da Sabrina, já com efeito de rádio VHF aplicado por
// `scripts/radioize-part2-audio.mjs`):
//   Material Didático/Pilots/Material Didático/Part 2/Audios/<slug>/
//     ├─ "1, 2 e 3"/s{N}-a{01,02}.mp3      → situações sem imagem (order_index 1..30)
//     └─ "4 e 5"/s{K}-a{01,02}-I.mp3       → situações com imagem (order_index 30+K)
//   <slug> = fixed-wing | rotary-wing.
//
// Objeto no Storage: `<prompt_id>/atc.mp3` e `<prompt_id>/followup.mp3` (mesma
// convenção por id que o pipeline antigo usava).
//
// Idempotente: `x-upsert` no Storage + `update` incondicional da URL — rodar de
// novo só re-sobe os mesmos arquivos e re-grava as mesmas URLs. `--dry-run` só
// lista o que faria. Pré-requisito: bucket criado
// (`scripts/create-pilot-prompt-audio-bucket.mjs`), `pg` instalado (--no-save),
// `pilot_prompts` já semeado (`scripts/seed-pilot-prompts.mjs`).
//
// Uso: `node scripts/upload-pilot-part2-audio.mjs [--dry-run]`
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

const AUDIO_ROOT =
  "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/Pilots/Material Didático/Part 2/Audios";
const SLUG = { fixed_wing: "fixed-wing", rotary_wing: "rotary-wing" };

// Caminho da gravação de uma fala (kind: "a01" | "a02") de uma situação.
function sourcePath(aircraftType, orderIndex, kind) {
  const slug = SLUG[aircraftType];
  if (orderIndex <= 30) {
    return `${AUDIO_ROOT}/${slug}/1, 2 e 3/s${orderIndex}-${kind}.mp3`;
  }
  const k = orderIndex - 30;
  return `${AUDIO_ROOT}/${slug}/4 e 5/s${k}-${kind}-I.mp3`;
}

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
    `select id, aircraft_type, order_index
       from public.pilot_prompts
      where is_active and part = 'part2'
      order by aircraft_type, order_index`,
  );

  let uploaded = 0;
  const missing = [];

  for (const row of rows) {
    for (const [kind, urlCol] of [
      ["a01", "atc_audio_url"],
      ["a02", "atc_followup_audio_url"],
    ]) {
      const src = sourcePath(row.aircraft_type, row.order_index, kind);
      if (!existsSync(src)) {
        missing.push(src);
        continue;
      }
      const objectPath = `${row.id}/${kind === "a01" ? "atc" : "followup"}.mp3`;
      if (DRY_RUN) {
        console.log(`[dry-run] ${row.aircraft_type} #${row.order_index} ${kind} -> ${objectPath}`);
        uploaded++;
        continue;
      }
      const url = await uploadObject(objectPath, readFileSync(src));
      await client.query(`update public.pilot_prompts set ${urlCol} = $1 where id = $2`, [url, row.id]);
      uploaded++;
      console.log(`OK ${row.aircraft_type} #${row.order_index} ${kind} -> ${url}`);
    }
  }

  await client.end();

  console.log(
    `\n${DRY_RUN ? "[dry-run] " : ""}${uploaded} fala(s) ${DRY_RUN ? "seriam enviadas" : "enviadas"}, ` +
      `${missing.length} arquivo(s) faltando.`,
  );
  if (missing.length > 0) {
    console.log("Faltando:");
    for (const m of missing) console.log(`  ${m}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
