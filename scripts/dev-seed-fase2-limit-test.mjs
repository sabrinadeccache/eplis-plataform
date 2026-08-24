// Utilitário de DEV: insere N tentativas fictícias `abandoned` da Fase 2 pra
// um usuário existente, todas com started_at = agora, só pra testar o aviso
// de limite diário (DAILY_ATTEMPT_LIMIT, ver
// src/services/simulations/phase2/limits.ts) sem gastar nenhuma chamada de
// IA de verdade — `status = 'abandoned'` propositalmente, pra não aparecer
// como tentativa "pausada" na tela /fase2 (que só considera
// mode = 'practice' e status = 'in_progress'), mas ainda contar pro limite
// diário (countAttemptsToday conta qualquer status).
// Imprime os IDs criados — guarde-os pra apagar depois com
// `node scripts/dev-delete-attempts.mjs <id1> <id2> ...`.
// Uso: `node scripts/dev-seed-fase2-limit-test.mjs <email> [quantidade=5]`.
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

async function main() {
  const [, , email, quantidadeArg] = process.argv;
  if (!email) {
    console.error("Uso: node scripts/dev-seed-fase2-limit-test.mjs <email> [quantidade=5]");
    process.exit(1);
  }
  const quantidade = Number(quantidadeArg ?? 5);

  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const { rows: users } = await client.query(`select id from public.users where email = $1`, [
    email,
  ]);
  if (users.length === 0) throw new Error(`Usuário não encontrado: ${email}`);
  const userId = users[0].id;

  const ids = [];
  for (let i = 0; i < quantidade; i++) {
    const { rows } = await client.query(
      `insert into public.simulation_attempts (user_id, phase, mode, status, started_at, finished_at)
       values ($1, 'phase2', 'practice', 'abandoned', now(), now())
       returning id`,
      [userId],
    );
    ids.push(rows[0].id);
  }

  console.log(`Criadas ${ids.length} tentativas fictícias para ${email}:`);
  for (const id of ids) console.log(`  ${id}`);
  console.log(
    `\nPra apagar depois: node scripts/dev-delete-attempts.mjs ${ids.join(" ")}`,
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
