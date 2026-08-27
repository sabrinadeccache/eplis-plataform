// Apaga TODOS os áudios sintéticos pré-gerados do SDEA (Parte 2 falas do ATC,
// Parte 3 diálogo piloto/controlador): remove os objetos do bucket de Storage
// `pilot-prompt-audio` e zera as colunas de URL em `pilot_prompts`
// (atc_audio_url / atc_followup_audio_url / dialogue_audio_url).
//
// Motivo: os áudios TTS serão regravados manualmente. O bucket em si é mantido.
// A app já cai no TTS em runtime quando a URL é null (ver pilot-interview-runner).
//
// Uso: `node scripts/delete-pilot-prompt-audio.mjs [--dry-run]`
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
const BUCKET = "pilot-prompt-audio";
const DRY = process.argv.includes("--dry-run");

const sb = (path, init) =>
  fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

// Lista recursiva do bucket (o list do Storage não é recursivo: primeiro os
// "diretórios" — um por prompt id — depois os arquivos dentro de cada um).
async function listAll(prefix = "") {
  const res = await sb(`object/list/${BUCKET}`, {
    method: "POST",
    body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: "name", order: "asc" } }),
  });
  if (!res.ok) throw new Error(`list "${prefix}" (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const entries = await res.json();
  const files = [];
  for (const e of entries) {
    const full = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.id === null) files.push(...(await listAll(full)));
    else files.push(full);
  }
  return files;
}

async function main() {
  const files = await listAll();
  console.log(`${files.length} objeto(s) no bucket ${BUCKET}:`);
  for (const f of files) console.log(`  ${f}`);

  const db = new Client({ connectionString: env.SUPABASE_DB_URL });
  await db.connect();
  const { rows } = await db.query(
    `select count(*)::int as n from pilot_prompts
      where atc_audio_url is not null
         or atc_followup_audio_url is not null
         or dialogue_audio_url is not null`,
  );
  console.log(`\n${rows[0].n} linha(s) de pilot_prompts com URL de áudio a zerar.`);

  if (DRY) {
    console.log("\n--dry-run: nada apagado.");
    await db.end();
    return;
  }

  if (files.length) {
    const res = await sb(`object/${BUCKET}`, {
      method: "DELETE",
      body: JSON.stringify({ prefixes: files }),
    });
    if (!res.ok) throw new Error(`delete (${res.status}): ${(await res.text()).slice(0, 300)}`);
    console.log(`\n${files.length} objeto(s) apagado(s) do Storage.`);
  }

  const upd = await db.query(
    `update pilot_prompts
        set atc_audio_url = null, atc_followup_audio_url = null, dialogue_audio_url = null
      where atc_audio_url is not null
         or atc_followup_audio_url is not null
         or dialogue_audio_url is not null`,
  );
  console.log(`${upd.rowCount} linha(s) de pilot_prompts zeradas.`);

  await db.end();
  console.log("\nPronto. O bucket foi mantido; a app usa TTS em runtime enquanto as URLs estiverem null.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
