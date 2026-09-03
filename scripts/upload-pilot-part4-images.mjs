// Sobe as fotos da Parte 4 do SDEA (descrição de imagem) pro bucket
// `pilot-images`: 13 cenas de avião (fixed_wing) + 10 de helicóptero
// (rotary_wing), fornecidas pela Sabrina em
// `Material Didático/Pilots/Material Didático/Part 4/Images/{fixed-wing,rotary-wing}/`
// (`fixed-wing01..13.png`, `rotary-wing01..10.png`, IA-geradas — sem questão de
// direitos). Cada PNG (até ~46 MB) é convertido pra JPEG (máx. 1600px, q82)
// com ImageMagick antes de subir.
//
// Uso único/idempotente (x-upsert): `node scripts/upload-pilot-part4-images.mjs`.
// Rode ANTES de `scripts/seed-pilot-prompts.mjs` (que cadastra as linhas da
// Parte 4 apontando pra essas URLs).
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

const SOURCE_ROOT =
  "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/Pilots/Material Didático";

const COUNTS = { fixed_wing: 13, rotary_wing: 10 };
const SLUG = { fixed_wing: "fixed-wing", rotary_wing: "rotary-wing" };

// URL pública da foto n (1-based) de um perfil. Importado por seed-pilot-prompts.mjs.
export function part4Url(aircraftType, n) {
  const nn = String(n).padStart(2, "0");
  return `${SUPABASE_URL}/storage/v1/object/public/pilot-images/${SLUG[aircraftType]}/part4/${nn}.jpg`;
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), "sdea-p4img-"));
  try {
    for (const [aircraftType, count] of Object.entries(COUNTS)) {
      for (let n = 1; n <= count; n++) {
        const nn = String(n).padStart(2, "0");
        const src = `${SOURCE_ROOT}/Part 4/Images/${SLUG[aircraftType]}/${SLUG[aircraftType]}${nn}.png`;
        const jpg = join(work, `${SLUG[aircraftType]}-${nn}.jpg`);
        execFileSync(MAGICK, [src, "-auto-orient", "-resize", "1600x1600>", "-quality", "82", jpg]);

        const objectPath = `${SLUG[aircraftType]}/part4/${nn}.jpg`;
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/pilot-images/${objectPath}`, {
          method: "POST",
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "image/jpeg",
            "x-upsert": "true",
          },
          body: readFileSync(jpg),
        });
        if (!res.ok) {
          throw new Error(`upload ${objectPath} falhou (${res.status}): ${(await res.text()).slice(0, 300)}`);
        }
        console.log(`OK: ${objectPath}`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
