// Utilitário de DEV: troca o operational_profile de um usuário já cadastrado,
// pra testar o conteúdo por perfil (Parte 2/4) sem precisar de uma conta nova
// por área. Uso: `node scripts/dev-set-profile.mjs <email> <TWR|APP|ACC|COpM>`
// (ou sem o terceiro argumento pra voltar o perfil pra nulo).
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

const VALID_PROFILES = ["TWR", "APP", "ACC", "COpM"];

async function main() {
  const [, , email, profile] = process.argv;
  if (!email) {
    console.error("Uso: node scripts/dev-set-profile.mjs <email> [TWR|APP|ACC|COpM]");
    process.exit(1);
  }
  if (profile && !VALID_PROFILES.includes(profile)) {
    console.error(`Perfil inválido: ${profile}. Use um de: ${VALID_PROFILES.join(", ")}`);
    process.exit(1);
  }

  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const { rows } = await client.query(
    `update public.users set operational_profile = $1 where email = $2 returning id, operational_profile`,
    [profile ?? null, email],
  );
  if (rows.length === 0) throw new Error(`Usuário não encontrado: ${email}`);

  console.log(`Perfil de ${email} atualizado para: ${rows[0].operational_profile ?? "(nenhum)"}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
