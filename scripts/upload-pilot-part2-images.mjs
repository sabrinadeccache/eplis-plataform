// Sobe as imagens de complicação da Parte 2 do SDEA (as situações com foto —
// slots 4 e 5 da prova) pro bucket público `pilot-images` e grava
// `complication_image_url` em `pilot_prompts`.
//
// Fonte: `Material Didático/.../Part 2/Images/<slug>/<slug>-<nome>.png`
// (<slug> = fixed-wing | rotary-wing). O mapa nome→situação vem das abas
// "FIXED-WING IMAGE" / "ROTARY-WING IMAGE" de `Part 2/questions-map.xlsx`: a
// situação `s{N}` da aba corresponde a `order_index = 30 + N` (as 30 primeiras
// situações do pool são as sem imagem). As listas abaixo são a coluna IMAGEM
// dessas abas, em ordem — mesma ordem em que `pilot-content-part234.mjs`
// gerou as linhas de `order_index` 31+ (conferido 1:1 pelo texto da situação).
//
// Cada PNG (até ~16 MB) é convertido pra JPEG (máx. 1600px, q82) com ImageMagick
// antes de subir, como em `upload-pilot-part4-images.mjs`.
//
// Idempotente (`x-upsert` + update incondicional). `--dry-run` só lista.
// Rode DEPOIS de `scripts/seed-pilot-prompts.mjs`.
// Uso: `node scripts/upload-pilot-part2-images.mjs [--dry-run]`
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const MAGICK = process.env.MAGICK_BIN || "magick";
const DRY_RUN = process.argv.includes("--dry-run");

const IMAGES_ROOT =
  "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/Pilots/Material Didático/Part 2/Images";

// coluna IMAGEM das abas *_IMAGE, em ordem de situação (s1, s2, …).
// order_index da situação = 30 + posição na lista (1-based).
const IMAGE_NAMES = {
  fixed_wing: [
    "weather", "tcas", "engine", "fuel", "altimeter", "ice", "pressurization",
    "gear", "hyd", "wetrwy", "metar", "ashes", "birds",
  ],
  rotary_wing: [
    "trees", "offshore", "pannel", "fog", "load", "rooftop", "hyd", "rescue",
    "smoke", "translines", "torque", "lowfuel", "lights", "people",
  ],
};
const SLUG = { fixed_wing: "fixed-wing", rotary_wing: "rotary-wing" };
const FIRST_IMAGE_ORDER = 31;

async function uploadObject(objectPath, buffer) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/pilot-images/${objectPath}`, {
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
    throw new Error(`upload ${objectPath} falhou (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/pilot-images/${objectPath}`;
}

async function main() {
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const { rows } = await client.query(
    `select id, aircraft_type, order_index
       from public.pilot_prompts
      where is_active and part = 'part2' and order_index >= $1
      order by aircraft_type, order_index`,
    [FIRST_IMAGE_ORDER],
  );

  const work = mkdtempSync(join(tmpdir(), "sdea-p2img-"));
  let done = 0;
  const problems = [];
  try {
    for (const row of rows) {
      const names = IMAGE_NAMES[row.aircraft_type];
      const slug = SLUG[row.aircraft_type];
      const pos = row.order_index - FIRST_IMAGE_ORDER; // 0-based
      const name = names?.[pos];
      if (!name) {
        problems.push(`sem imagem mapeada pra ${row.aircraft_type} order_index ${row.order_index}`);
        continue;
      }
      const src = `${IMAGES_ROOT}/${slug}/${slug}-${name}.png`;
      const objectPath = `${slug}/part2/${row.order_index}.jpg`;
      if (DRY_RUN) {
        console.log(`[dry-run] ${row.aircraft_type} #${row.order_index} <- ${slug}-${name}.png -> ${objectPath}`);
        done++;
        continue;
      }
      const jpg = join(work, `${slug}-${row.order_index}.jpg`);
      execFileSync(MAGICK, [src, "-auto-orient", "-resize", "1600x1600>", "-quality", "82", jpg]);
      const url = await uploadObject(objectPath, readFileSync(jpg));
      await client.query(
        `update public.pilot_prompts set complication_image_url = $1 where id = $2`,
        [url, row.id],
      );
      done++;
      console.log(`OK ${row.aircraft_type} #${row.order_index} (${name}) -> ${url}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  await client.end();

  console.log(`\n${DRY_RUN ? "[dry-run] " : ""}${done} imagem(ns) ${DRY_RUN ? "seriam enviadas" : "enviadas"}.`);
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
