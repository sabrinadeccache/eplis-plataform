// Utilitário de DEV: cria um usuário de teste já com role='pilot' e um
// operational_profile (fixed_wing/rotary_wing), pra testar a trilha SDEA sem
// passar pelo fluxo de cadastro + confirmação de e-mail manualmente. Mesmo
// padrão de scripts/dev-set-profile.mjs (equivalente pro controlador). Uso:
// `node scripts/dev-create-pilot-test-user.mjs <email> <senha> <fixed_wing|rotary_wing>`.
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

const VALID_PROFILES = ["fixed_wing", "rotary_wing"];

async function main() {
  const [, , email, password, profile] = process.argv;
  if (!email || !password || !VALID_PROFILES.includes(profile)) {
    console.error(
      "Uso: node scripts/dev-create-pilot-test-user.mjs <email> <senha> <fixed_wing|rotary_wing>",
    );
    process.exit(1);
  }

  const env = loadEnv();
  const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: "Teste Piloto" } }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Falha ao criar usuário: ${JSON.stringify(body)}`);
  const userId = body.id;

  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();
  await client.query(`update public.users set role = 'pilot', operational_profile = $1 where id = $2`, [
    profile,
    userId,
  ]);
  await client.end();

  console.log(`Usuário de teste criado: ${email} (id ${userId}), role=pilot, operational_profile=${profile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
