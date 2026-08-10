// Registra as 4 imagens reais da Parte 4 (uma por perfil operacional — TWR,
// APP, ACC, COpM) já enviadas pela Sabrina pro bucket "phase2-images"
// (nomeadas <PERFIL>-01, ex.: TWR-01.png), substituindo os placeholders
// (picsum, 'general' + os 2 de teste 'TWR') que existiam só pra validar o
// mecanismo de sorteio por perfil antes de haver conteúdo real. Como
// PART_SIZES.part4 é 1 e cada perfil passa a ter exatamente 1 imagem real
// (nenhum placeholder 'general' concorrendo no pool), o sorteio da Parte 4
// fica determinístico por perfil — ver src/services/simulations/phase2/
// queries.ts (profileFilter = [profile, 'general']).
//
// Só desativa os placeholders 'general'/'TWR' de teste, nunca apaga (mesmo
// padrão do restante do projeto — ver CLAUDE.md). Idempotente via UPSERT por
// image_url. Uso: `node scripts/seed-phase2-part4-profile-images.mjs`.
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

const IMAGES = [
  { profile: "TWR", path: "TWR-01.png" },
  { profile: "APP", path: "APP-01.jpg" },
  { profile: "ACC", path: "ACC-01.webp" },
  { profile: "COpM", path: "COpM-01.jpg" },
];

const PROMPT_TEXT = "Describe what you see in this image.";
const SECONDS = 120;

async function main() {
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  for (const { profile, path } of IMAGES) {
    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/phase2-images/${path}`;
    const { rows } = await client.query(
      `update public.phase2_prompts
         set prompt_text = $1, expected_duration_seconds = $2, operational_profile = $3, is_active = true
       where part = 'part4' and image_url = $4
       returning id`,
      [PROMPT_TEXT, SECONDS, profile, imageUrl],
    );
    if (rows.length === 0) {
      await client.query(
        `insert into public.phase2_prompts
           (part, operational_profile, prompt_text, image_url, expected_duration_seconds, is_active)
         values ('part4', $1, $2, $3, $4, true)`,
        [profile, PROMPT_TEXT, imageUrl, SECONDS],
      );
    }
    console.log(`Parte 4 / ${profile}: ${imageUrl}`);
  }

  // Desativa os placeholders antigos ('general' em picsum.photos + os 2 de
  // teste 'TWR', hospedados no próprio bucket como twr-test-*.jpg) pra que
  // cada perfil real (TWR/APP/ACC/COpM) só sorteie sua própria foto — sem
  // isso, eles continuariam entrando no pool via
  // profileFilter = [profile, 'general'].
  const keptUrls = IMAGES.map(({ path }) => `${SUPABASE_URL}/storage/v1/object/public/phase2-images/${path}`);
  const { rowCount } = await client.query(
    `update public.phase2_prompts
       set is_active = false
     where part = 'part4' and not (image_url = any($1::text[]))`,
    [keptUrls],
  );
  console.log(`Desativados ${rowCount} placeholders antigos da Parte 4.`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
