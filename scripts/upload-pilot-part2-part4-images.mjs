// Sobe as 3 fotos reais de avião (fixed_wing) usadas na Parte 2/4 do SDEA —
// extraídas do documento oficial "Modelo SDEA.pdf" da ANAC (radar
// meteorológico e bird strike, complicações da Parte 2; pneu estourado, foto
// da Parte 4). Fotos de helicóptero (rotary_wing) ficaram de fora desta
// rodada por questão de direitos autorais (as únicas disponíveis tinham
// marca d'água de banco de imagens ou eram fotos profissionais sem licença
// clara) — o pool de Parte 4 de rotary_wing fica vazio até haver fotos
// próprias/licenciadas. Uso único/idempotente (upsert: true):
// `node scripts/upload-pilot-part2-part4-images.mjs`.
import { readFileSync } from "node:fs";

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

const SOURCE_DIR = "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Pilots/Material Didático/Fase 2 - Images";

export const IMAGES = [
  { file: "sdea-fixed-wing-weather-radar.jpg", path: "fixed-wing/part2-situation-4-weather-radar.jpg" },
  { file: "sdea-fixed-wing-bird-strike.jpg", path: "fixed-wing/part2-situation-5-bird-strike.jpg" },
  { file: "sdea-fixed-wing-tire-blowout.jpg", path: "fixed-wing/part4-tire-blowout.jpg" },
];

export function publicUrlFor(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/pilot-images/${path}`;
}

async function upload({ file, path }) {
  const buffer = readFileSync(`${SOURCE_DIR}/${file}`);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/pilot-images/${path}`, {
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
    throw new Error(`Falha ao subir ${path} (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  console.log(`OK: ${path} -> ${publicUrlFor(path)}`);
}

async function main() {
  for (const image of IMAGES) {
    await upload(image);
  }
}

// Só sobe as imagens quando o arquivo é executado diretamente — quando
// importado só por `publicUrlFor` (ex.: scripts/seed-pilot-prompts.mjs), o
// upload não deve rodar de novo.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
