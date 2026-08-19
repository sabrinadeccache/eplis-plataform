// Cria o bucket de Storage "avatars" (foto de perfil do usuário). Uso
// único/idempotente: `node scripts/create-avatars-bucket.mjs`.
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

async function main() {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "avatars",
      name: "avatars",
      public: true,
      file_size_limit: 5 * 1024 * 1024,
      allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
    }),
  });

  if (res.ok) {
    console.log("Bucket avatars criado.");
    return;
  }

  const body = await res.text();
  if (res.status === 400 && /already exists/i.test(body)) {
    console.log("Bucket avatars já existe — ok.");
    return;
  }

  throw new Error(`Falha ao criar bucket (${res.status}): ${body.slice(0, 300)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
