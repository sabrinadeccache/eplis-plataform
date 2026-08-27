// Cria o bucket de Storage "pilot-prompt-audio" (áudios pré-gerados das falas
// do ATC na Parte 2 e da gravação piloto/controlador na Parte 3 do SDEA — TTS
// + efeito de rádio). Conteúdo de prova, não é dado de usuário, então bucket
// público de leitura, sem policy por dono (mesmo padrão de pilot-images).
// Uso único/idempotente: `node scripts/create-pilot-prompt-audio-bucket.mjs`.
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
      id: "pilot-prompt-audio",
      name: "pilot-prompt-audio",
      public: true,
    }),
  });

  if (res.ok) {
    console.log("Bucket pilot-prompt-audio criado.");
    return;
  }

  const body = await res.text();
  if (res.status === 400 && /already exists/i.test(body)) {
    console.log("Bucket pilot-prompt-audio já existe — ok.");
    return;
  }

  throw new Error(`Falha ao criar bucket (${res.status}): ${body.slice(0, 300)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
