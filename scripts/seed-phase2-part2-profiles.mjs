// Substitui o conteúdo placeholder ('general') da Parte 2 por conteúdo real,
// segmentado por perfil operacional: 10 situações para cada uma das 4 áreas
// (TWR, APP, ACC, COpM). Cada situação é uma ocorrência operacional realista
// pro dia a dia daquela área (torre, aproximação, área de controle, defesa
// aérea/operações militares), sempre terminando em "What's the situation?" —
// gatilho fixo que habilita o botão de resposta no runner (ver
// interview-runner.tsx).
//
// Rodar só depois de `scripts/dev-clean-test-data.mjs` (que apaga as
// phase2_responses de teste) — assim é seguro fazer DELETE de verdade nas
// linhas antigas da Parte 2 em vez de só desativar, já que não sobra nenhuma
// resposta histórica apontando pra elas via FK.
//
// Uso: `node scripts/seed-phase2-part2-profiles.mjs`.
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

const TWR = [
  "A ground vehicle crosses onto the active runway without clearance while an aircraft is on short final. What's the situation?",
  "You spot a flock of birds crossing the runway just as an aircraft is about to depart. What's the situation?",
  "An aircraft on final approach reports a landing gear warning light. What's the situation?",
  "A pilot reports strong wind shear during final approach. What's the situation?",
  "Two aircraft read back a clearance for the same runway at the same time. What's the situation?",
  "An aircraft that just landed reports it cannot vacate the runway due to a blown tire. What's the situation?",
  "A pilot initiates a go-around after an unstable approach. What's the situation?",
  "A light aircraft enters the aerodrome traffic pattern without prior radio contact. What's the situation?",
  "An aircraft holding short of the runway reports smoke coming from one engine. What's the situation?",
  "Visibility suddenly drops due to fog while several aircraft are in the traffic pattern. What's the situation?",
];

const APP = [
  "An arriving aircraft reports a TCAS resolution advisory during descent. What's the situation?",
  "Two aircraft under your control are converging at the same altitude in the terminal area. What's the situation?",
  "A pilot requests a deviation from the arrival route due to a thunderstorm cell ahead. What's the situation?",
  "An aircraft goes around after the crew reports the runway is not in sight at minimums. What's the situation?",
  "You notice the separation between an arriving and a departing aircraft has fallen below the minimum. What's the situation?",
  "An aircraft reports a partial loss of navigation equipment while being vectored for approach. What's the situation?",
  "Holding stacks are filling up quickly after the airport briefly closes for a disabled aircraft on the runway. What's the situation?",
  "A pilot declares minimum fuel and requests priority for approach. What's the situation?",
  "A following aircraft reports a wake turbulence encounter behind a heavy jet. What's the situation?",
  "You lose radio contact with an aircraft that is currently being vectored for final approach. What's the situation?",
];

const ACC = [
  "A pilot reports a passenger medical emergency and requests an immediate diversion. What's the situation?",
  "An aircraft requests a flight level change to avoid severe turbulence reported by preceding traffic. What's the situation?",
  "You lose radio communication with an aircraft cruising through your sector. What's the situation?",
  "A pilot reports an engine failure and requests an emergency descent. What's the situation?",
  "A line of severe thunderstorms blocks a busy airway, and several aircraft request deviations at once. What's the situation?",
  "Two aircraft on crossing routes are converging at the same flight level. What's the situation?",
  "An aircraft declares a fuel emergency and requests the most direct routing to the nearest suitable airport. What's the situation?",
  "A crew reports a sudden cabin depressurization and begins an emergency descent. What's the situation?",
  "A crew reports an unruly passenger onboard and requests priority handling to divert. What's the situation?",
  "An aircraft ahead on the same route reports volcanic ash and several flights request rerouting. What's the situation?",
];

const COPM = [
  "An unidentified aircraft is detected entering a restricted area without prior authorization. What's the situation?",
  "An aircraft fails to respond to repeated radio calls while flying through an active military exercise area. What's the situation?",
  "Coordination is needed to scramble an interceptor to identify an unknown radar contact approaching a controlled zone. What's the situation?",
  "A civil aircraft strays into a temporarily segregated area during a scheduled military exercise. What's the situation?",
  "You lose the transponder (IFF) signal from a military aircraft you were tracking. What's the situation?",
  "An aircraft deviates suspiciously from its filed flight plan and stops responding, raising concern about a possible hijacking. What's the situation?",
  "A neighboring FIR/military unit reports an unidentified track approaching the shared boundary and requests coordination. What's the situation?",
  "An aircraft is detected inside a prohibited area near a sensitive installation. What's the situation?",
  "Two aircraft engaged in a joint exercise report unexpectedly converging tracks. What's the situation?",
  "An air policing mission requires immediate escort of a non-compliant aircraft to a designated airport. What's the situation?",
];

const BY_PROFILE = { TWR, APP, ACC, COpM: COPM };

async function main() {
  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const { rowCount: deleted } = await client.query(
    `delete from public.phase2_prompts where part = 'part2'`,
  );
  console.log(`Removidos ${deleted} prompts antigos da Parte 2.`);

  let inserted = 0;
  for (const [profile, situations] of Object.entries(BY_PROFILE)) {
    for (let i = 0; i < situations.length; i++) {
      await client.query(
        `insert into public.phase2_prompts
           (part, operational_profile, prompt_text, expected_duration_seconds, order_index, is_active)
         values ('part2', $1, $2, $3, $4, true)`,
        [profile, situations[i], SECONDS, i + 1],
      );
      inserted++;
    }
  }

  console.log(`Inseridos ${inserted} prompts novos da Parte 2 (10 por perfil: TWR, APP, ACC, COpM).`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
