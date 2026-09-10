// Substitui TODO o pool da Parte 2 da Fase 2 pelo mapa oficial da Sabrina
// (`Material Didático/ATC/Phase 2/mapa_questoes_part2.xlsx`) — 80 situações por
// perfil operacional (TWR, APP, ACC, COpM), 320 no total. Dados normalizados em
// `scripts/data/phase2-part2.json`.
//
// NÃO faz DELETE: já existem `phase2_responses` reais apontando pra
// `phase2_prompts.id` da Parte 2 (FK), e um DELETE na tabela falha com
// "violates foreign key constraint" (ver CLAUDE.md). Em vez disso: UPSERT por
// (part='part2', operational_profile, order_index) — as linhas 1..30 que já
// existem são reescritas in-place com o texto novo, as 31..80 são inseridas —
// e qualquer linha da Parte 2 com order_index > 80 é desativada
// (`is_active = false`). Idempotente.
//
// Efeito colateral aceito: as ~21 respostas de teste que apontavam pros prompts
// antigos passam a exibir o texto novo nas telas de resultado. Tentativas de
// Fase 2 em andamento têm a sequência recalculada do pool ativo a cada render,
// então também passam a ver o conteúdo novo.
//
// Uso: `node scripts/replace-phase2-part2-situations.mjs`
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

const SECONDS = 45;
const PER_PROFILE = 80;

const BY_PROFILE = JSON.parse(
  readFileSync(new URL("./data/phase2-part2.json", import.meta.url), "utf8"),
);

async function main() {
  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  let updated = 0;
  let inserted = 0;

  for (const [profile, situations] of Object.entries(BY_PROFILE)) {
    if (situations.length !== PER_PROFILE) {
      throw new Error(`${profile}: esperava ${PER_PROFILE} situações, veio ${situations.length}.`);
    }

    for (let i = 0; i < situations.length; i++) {
      const orderIndex = i + 1;
      const text = situations[i].trim();

      const existing = await client.query(
        `select id from public.phase2_prompts
          where part = 'part2' and operational_profile = $1 and order_index = $2`,
        [profile, orderIndex],
      );

      if (existing.rows.length > 0) {
        await client.query(
          `update public.phase2_prompts
              set prompt_text = $1, expected_duration_seconds = $2, image_url = null,
                  is_active = true
            where id = $3`,
          [text, SECONDS, existing.rows[0].id],
        );
        updated++;
      } else {
        await client.query(
          `insert into public.phase2_prompts
             (part, operational_profile, prompt_text, expected_duration_seconds, order_index, is_active)
           values ('part2', $1, $2, $3, $4, true)`,
          [profile, text, SECONDS, orderIndex],
        );
        inserted++;
      }
    }

    const { rowCount: deactivated } = await client.query(
      `update public.phase2_prompts
          set is_active = false
        where part = 'part2' and operational_profile = $1 and order_index > $2
          and is_active = true`,
      [profile, PER_PROFILE],
    );
    console.log(
      `${profile}: ${PER_PROFILE} situações ativas` +
        (deactivated ? ` (${deactivated} antigas desativadas)` : ""),
    );
  }

  console.log(`\nParte 2: ${updated} prompts atualizados, ${inserted} inseridos.`);

  const totals = await client.query(
    `select operational_profile, count(*) filter (where is_active) as ativos,
            count(*) as total
       from public.phase2_prompts
      where part = 'part2'
      group by operational_profile
      order by operational_profile`,
  );
  for (const r of totals.rows) {
    console.log(`  ${r.operational_profile}: ${r.ativos} ativos / ${r.total} total`);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
