// Utilitário de DEV: cria N tentativas fictícias e já concluídas da Fase 1
// (simulation_attempts + phase1_answers) pra um usuário existente, com datas e
// resultados variados (aprovado/reprovado), só pra visualizar a tela de
// Desempenho (/desempenho/fase1) sem precisar refazer o simulado várias vezes
// de verdade. Usa as questões ativas já cadastradas (`phase1_questions`).
// Pra limpar depois: `node scripts/dev-clean-test-data.mjs`.
// Uso: `node scripts/dev-seed-fase1-demo.mjs <email>`.
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

// Cada entrada: quantos dias atrás terminou, e quantas corretas de 10.
const SCENARIOS = [
  { daysAgo: 8, correct: 9 },
  { daysAgo: 6, correct: 5 },
  { daysAgo: 4, correct: 7 },
  { daysAgo: 2, correct: 6 },
  { daysAgo: 0, correct: 8 },
];

async function main() {
  const [, , email] = process.argv;
  if (!email) {
    console.error("Uso: node scripts/dev-seed-fase1-demo.mjs <email>");
    process.exit(1);
  }

  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const { rows: users } = await client.query(`select id from public.users where email = $1`, [
    email,
  ]);
  if (users.length === 0) throw new Error(`Usuário não encontrado: ${email}`);
  const userId = users[0].id;

  const { rows: questions } = await client.query(
    `select id, correct_option from public.phase1_questions where is_active = true limit 10`,
  );
  if (questions.length === 0) throw new Error("Nenhuma questão ativa da Fase 1 encontrada.");

  for (const { daysAgo, correct } of SCENARIOS) {
    const { rows: attemptRows } = await client.query(
      `insert into public.simulation_attempts (user_id, phase, mode, status, score, started_at, finished_at)
       values ($1, 'phase1', 'practice', 'completed', $2, now() - ($3 || ' days')::interval - interval '10 minutes', now() - ($3 || ' days')::interval)
       returning id`,
      [userId, correct, daysAgo],
    );
    const attemptId = attemptRows[0].id;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const isCorrect = i < correct;
      const selected = isCorrect
        ? q.correct_option
        : q.correct_option === "a"
          ? "b"
          : "a";
      await client.query(
        `insert into public.phase1_answers (simulation_attempt_id, question_id, selected_option, is_correct)
         values ($1, $2, $3, $4)`,
        [attemptId, q.id, selected, isCorrect],
      );
    }

    console.log(
      `Criado: ${attemptId} — ${daysAgo} dia(s) atrás, ${correct}/${questions.length} acertos.`,
    );
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
