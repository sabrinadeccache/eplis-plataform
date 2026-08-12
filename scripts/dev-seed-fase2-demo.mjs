// Utilitário de DEV: cria N tentativas fictícias e já concluídas da Fase 2
// (simulation_attempts + simulation_feedbacks) pra um usuário existente, com
// datas e níveis variados, só pra visualizar a tela de Desempenho
// (/desempenho/fase2) sem precisar fazer a entrevista completa várias vezes
// de verdade. Não cria phase2_responses (a tela de Desempenho e o card de
// nível geral do relatório não dependem delas — só a lista de "respostas
// individuais" do relatório fica vazia, o que a tela já trata graciosamente).
// Pra limpar depois: `node scripts/dev-clean-test-data.mjs`.
// Uso: `node scripts/dev-seed-fase2-demo.mjs <email>`.
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

// Cada critério é independente, mas overall precisa ser sempre o MENOR entre
// os 6 (regra de segurança operacional da OACI, já aplicada no app de
// verdade) — os cenários abaixo já respeitam isso.
const SCENARIOS = [
  {
    daysAgo: 9,
    overall: "weak",
    criteria: {
      pronunciation_score: "weak",
      structure_score: "moderate",
      vocabulary_score: "good",
      fluency_score: "moderate",
      comprehension_score: "good",
      interaction_score: "moderate",
    },
    feedback:
      "Simulado fictício (dado de demonstração). Pronúncia foi o critério mais fraco, puxando o nível geral para baixo mesmo com bom desempenho em vocabulário e compreensão.",
  },
  {
    daysAgo: 7,
    overall: "moderate",
    criteria: {
      pronunciation_score: "moderate",
      structure_score: "good",
      vocabulary_score: "moderate",
      fluency_score: "good",
      comprehension_score: "moderate",
      interaction_score: "good",
    },
    feedback:
      "Simulado fictício (dado de demonstração). Estrutura, fluência e interações já em nível bom; pronúncia, vocabulário e compreensão ainda moderados.",
  },
  {
    daysAgo: 5,
    overall: "moderate",
    criteria: {
      pronunciation_score: "good",
      structure_score: "moderate",
      vocabulary_score: "good",
      fluency_score: "moderate",
      comprehension_score: "good",
      interaction_score: "good",
    },
    feedback:
      "Simulado fictício (dado de demonstração). Progresso em relação ao anterior — só estrutura e fluência seguram o nível geral em moderado.",
  },
  {
    daysAgo: 3,
    overall: "good",
    criteria: {
      pronunciation_score: "good",
      structure_score: "good",
      vocabulary_score: "good",
      fluency_score: "good",
      comprehension_score: "good",
      interaction_score: "good",
    },
    feedback:
      "Simulado fictício (dado de demonstração). Todos os 6 critérios em nível bom — melhor resultado da série.",
  },
  {
    daysAgo: 0,
    overall: "moderate",
    criteria: {
      pronunciation_score: "good",
      structure_score: "good",
      vocabulary_score: "moderate",
      fluency_score: "good",
      comprehension_score: "good",
      interaction_score: "good",
    },
    feedback:
      "Simulado fictício (dado de demonstração). Pequena oscilação em vocabulário derrubou o nível geral, mas os demais critérios seguem consistentes em bom.",
  },
];

async function main() {
  const [, , email] = process.argv;
  if (!email) {
    console.error("Uso: node scripts/dev-seed-fase2-demo.mjs <email>");
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

  for (const scenario of SCENARIOS) {
    const { rows: attemptRows } = await client.query(
      `insert into public.simulation_attempts (user_id, phase, mode, status, started_at, finished_at)
       values ($1, 'phase2', 'practice', 'completed',
               now() - ($2 || ' days')::interval - interval '25 minutes',
               now() - ($2 || ' days')::interval)
       returning id`,
      [userId, scenario.daysAgo],
    );
    const attemptId = attemptRows[0].id;
    const c = scenario.criteria;

    await client.query(
      `insert into public.simulation_feedbacks
         (simulation_attempt_id, phase, overall_score, pronunciation_score, structure_score,
          vocabulary_score, fluency_score, comprehension_score, interaction_score,
          general_feedback, ai_provider, model_version)
       values ($1, 'phase2', $2, $3, $4, $5, $6, $7, $8, $9, 'anthropic', 'claude-sonnet-5')`,
      [
        attemptId,
        scenario.overall,
        c.pronunciation_score,
        c.structure_score,
        c.vocabulary_score,
        c.fluency_score,
        c.comprehension_score,
        c.interaction_score,
        scenario.feedback,
      ],
    );

    console.log(
      `Criado: ${attemptId} — ${scenario.daysAgo} dia(s) atrás, nível geral ${scenario.overall}.`,
    );
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
