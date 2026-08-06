// TEMP/teste: baixa 2 imagens placeholder, sobe pro bucket "phase2-images" e
// cadastra 2 itens da Parte 4 com operational_profile = 'TWR' (distintos dos
// 3 itens 'general' já existentes) — só pra validar que o sorteio de imagem
// da Parte 4 respeita o perfil operacional do candidato (ver
// src/services/simulations/phase2/queries.ts, profileFilter = [profile,
// 'general']). Ainda são fotos placeholder (picsum), não fotos reais de
// torre de controle — substituir quando houver imagens reais fornecidas pela
// Sabrina, mesmo padrão já usado nos áudios da Fase 1
// (scripts/replace-phase1-audios.mjs). Idempotente via UPSERT (mesma lógica
// de scripts/seed-phase2-prompts.mjs). Uso:
// `node scripts/seed-phase2-images-twr-test.mjs`.
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

const TWR_TEST_IMAGES = [
  { sourceUrl: "https://picsum.photos/id/1035/1024/768", path: "twr-test-1.jpg" },
  { sourceUrl: "https://picsum.photos/id/1041/1024/768", path: "twr-test-2.jpg" },
];

async function uploadFromSource(sourceUrl, path) {
  const sourceRes = await fetch(sourceUrl);
  if (!sourceRes.ok) throw new Error(`Falha ao baixar imagem de origem (${sourceRes.status}): ${sourceUrl}`);
  const buffer = Buffer.from(await sourceRes.arrayBuffer());

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/phase2-images/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload falhou (${res.status}): ${body.slice(0, 300)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/phase2-images/${path}`;
}

async function upsertByImageUrl(client, imageUrl) {
  const { rows } = await client.query(
    `update public.phase2_prompts
       set prompt_text = $1, expected_duration_seconds = $2, is_active = true
     where part = 'part4' and operational_profile = 'TWR' and image_url = $3
     returning id`,
    ["Describe what you see in this image.", 120, imageUrl],
  );
  if (rows.length > 0) return;
  await client.query(
    `insert into public.phase2_prompts
       (part, operational_profile, prompt_text, image_url, expected_duration_seconds, is_active)
     values ('part4', 'TWR', $1, $2, $3, true)`,
    ["Describe what you see in this image.", imageUrl, 120],
  );
}

async function main() {
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  for (const item of TWR_TEST_IMAGES) {
    const imageUrl = await uploadFromSource(item.sourceUrl, item.path);
    await upsertByImageUrl(client, imageUrl);
    console.log(`OK: ${item.path} -> ${imageUrl}`);
  }

  await client.end();
  console.log(`Seed concluído: ${TWR_TEST_IMAGES.length} imagens de teste (perfil TWR) na Parte 4.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
