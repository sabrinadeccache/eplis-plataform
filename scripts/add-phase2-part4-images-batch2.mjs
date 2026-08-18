// Adiciona as novas imagens da Parte 4 (uma pasta por perfil operacional em
// `Material Didático/Phase 2 - Images/<PERFIL>/`, arquivos numerados 1..N)
// ao bucket "phase2-images" + tabela phase2_prompts. Não mexe nas 4 imagens
// "-01" já existentes (uma por perfil, cadastradas antes) — só adiciona,
// deixando o sorteio da Parte 4 realmente aleatório dentro de cada perfil em
// vez de determinístico numa imagem só.
//
// Aditivo, UPSERT por image_url — idempotente, seguro rodar de novo.
// Uso: `node scripts/add-phase2-part4-images-batch2.mjs`
import { readFileSync, readdirSync } from "node:fs";
import { extname } from "node:path";
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

const SOURCE_DIR = "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/Phase 2 - Images";
const PROFILES = ["TWR", "APP", "ACC", "COpM"];
const PROMPT_TEXT = "Describe what you see in this image.";
const SECONDS = 120;

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

async function upload(path, buffer, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/phase2-images/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": contentType,
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

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  let inserted = 0;
  let updated = 0;

  for (const profile of PROFILES) {
    const dir = `${SOURCE_DIR}/${profile}`;
    const files = readdirSync(dir)
      .filter((f) => Object.keys(CONTENT_TYPES).includes(extname(f).toLowerCase()))
      .sort((a, b) => parseInt(a) - parseInt(b));

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      const contentType = CONTENT_TYPES[ext];
      const storagePath = `${profile}-batch2-${file}`;
      const buffer = readFileSync(`${dir}/${file}`);
      const imageUrl = await upload(storagePath, buffer, contentType);

      const { rows } = await db.query(
        `update public.phase2_prompts
           set prompt_text = $1, expected_duration_seconds = $2, operational_profile = $3, is_active = true
         where part = 'part4' and image_url = $4
         returning id`,
        [PROMPT_TEXT, SECONDS, profile, imageUrl],
      );
      if (rows.length > 0) {
        updated++;
      } else {
        await db.query(
          `insert into public.phase2_prompts
             (part, operational_profile, prompt_text, image_url, expected_duration_seconds, is_active)
           values ('part4', $1, $2, $3, $4, true)`,
          [profile, PROMPT_TEXT, imageUrl, SECONDS],
        );
        inserted++;
      }
    }
    console.log(`${profile}: ${files.length} imagens processadas.`);
  }

  console.log(`\nParte 4: ${inserted} imagens novas inseridas, ${updated} já existentes atualizadas.`);

  const { rows: counts } = await db.query(
    `select operational_profile, count(*) from public.phase2_prompts where part = 'part4' and is_active group by 1 order by 1`,
  );
  console.log("Pool final da Parte 4 por perfil:", counts);

  await db.end();
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
