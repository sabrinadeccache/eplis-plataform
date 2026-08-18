// Adiciona 10 situações novas da Parte 2 para cada perfil operacional (TWR,
// APP, ACC, COpM), levando o pool de 10 para 20 por perfil — a pedido da
// Sabrina, pra ampliar a variedade do sorteio. Segue o mesmo padrão das 10
// já existentes (script original `seed-phase2-part2-profiles.mjs`): cada
// situação termina em "What's the situation?" (gatilho fixo do runner).
//
// Aditivo — não apaga nem mexe nas 10 situações já existentes de cada
// perfil. UPSERT por (operational_profile, order_index): as novas ocupam
// order_index 11-20. Idempotente, seguro rodar de novo.
// Uso: `node scripts/add-phase2-part2-situations-batch2.mjs`
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
  "An aircraft reports a bird strike immediately after touchdown and requests a runway inspection. What's the situation?",
  "Two aircraft are cleared to line up on intersecting runways at nearly the same time. What's the situation?",
  "A pilot reports a deflated nose tire while taxiing in after landing. What's the situation?",
  "An aircraft on final approach transmits a suspected unlawful interference signal. What's the situation?",
  "A departing aircraft rejects takeoff at high speed due to an engine indication. What's the situation?",
  "A helicopter requests an emergency landing on the taxiway due to a mechanical issue. What's the situation?",
  "An aircraft reports a bird strike during climb-out with possible engine damage. What's the situation?",
  "Ground control loses radio contact with an aircraft taxiing near an active runway. What's the situation?",
  "A pilot reports a cabin door warning light illuminated just before departure. What's the situation?",
  "Sudden severe crosswind gusts force a pilot to request a runway change at short notice. What's the situation?",
];

const APP = [
  "An arriving aircraft reports a bird strike during descent and requests priority handling. What's the situation?",
  "A pilot reports spatial disorientation and requests vectors to the nearest suitable airport. What's the situation?",
  "An aircraft under your control reports an unsafe landing gear indication during approach. What's the situation?",
  "Two arriving aircraft request the same approach slot due to a scheduling conflict. What's the situation?",
  "A pilot reports icing conditions during approach and requests a lower altitude. What's the situation?",
  "An aircraft executes a missed approach after receiving a late runway-change instruction. What's the situation?",
  "A general aviation aircraft strays into your approach corridor without clearance. What's the situation?",
  "An aircraft reports smoke in the cockpit while being vectored for approach. What's the situation?",
  "A pilot reports a bird strike on final approach and requests emergency services standing by. What's the situation?",
  "Radar coverage is temporarily lost for an aircraft in your final approach sequence. What's the situation?",
];

const ACC = [
  "An aircraft requests an unplanned diversion due to a mechanical warning light. What's the situation?",
  "A pilot reports loss of GPS/navigation signal while flying in oceanic airspace. What's the situation?",
  "Two aircraft on the same airway report conflicting altitude assignments. What's the situation?",
  "An aircraft reports a bird strike at cruise altitude with unknown damage. What's the situation?",
  "A pilot requests priority handling due to a rapidly deteriorating medical emergency onboard. What's the situation?",
  "A crew reports smoke in the cabin at cruise altitude and requests immediate descent. What's the situation?",
  "An aircraft loses one engine at cruise and requests a lower altitude and diversion. What's the situation?",
  "Severe clear-air turbulence injures passengers and the crew requests priority handling. What's the situation?",
  "An aircraft reports a pressurization problem and initiates an emergency descent. What's the situation?",
  "A crew reports a security concern about a passenger's behavior mid-flight. What's the situation?",
];

const COPM = [
  "A civil aircraft loses radio contact while transiting near a restricted military zone. What's the situation?",
  "An unknown radar track appears without a flight plan near the border of controlled airspace. What's the situation?",
  "A military aircraft reports a technical malfunction during a joint exercise and requests priority recovery. What's the situation?",
  "An aircraft's transponder squawks an emergency code while flying near a sensitive installation. What's the situation?",
  "Coordination is required after a foreign military aircraft enters national airspace without authorization. What's the situation?",
  "An intercepted aircraft fails to respond to visual signals from the escorting interceptor. What's the situation?",
  "A civil aircraft deviates from its cleared route into an active air defense identification zone. What's the situation?",
  "Radar contact is lost with a military aircraft during a low-level training mission. What's the situation?",
  "An unidentified aircraft approaches a temporary flight restriction area during a high-profile event. What's the situation?",
  "Two aircraft from different commands report converging tracks during a joint air-policing mission. What's the situation?",
];

const BY_PROFILE = { TWR, APP, ACC, COpM: COPM };

async function main() {
  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  let inserted = 0;
  let updated = 0;

  for (const [profile, situations] of Object.entries(BY_PROFILE)) {
    for (let i = 0; i < situations.length; i++) {
      const orderIndex = i + 11; // continua depois das 10 já existentes (1-10)
      const { rows } = await client.query(
        `update public.phase2_prompts
           set prompt_text = $1, expected_duration_seconds = $2, is_active = true
         where part = 'part2' and operational_profile = $3 and order_index = $4
         returning id`,
        [situations[i], SECONDS, profile, orderIndex],
      );
      if (rows.length > 0) {
        updated++;
      } else {
        await client.query(
          `insert into public.phase2_prompts
             (part, operational_profile, prompt_text, expected_duration_seconds, order_index, is_active)
           values ('part2', $1, $2, $3, $4, true)`,
          [profile, situations[i], SECONDS, orderIndex],
        );
        inserted++;
      }
    }
    console.log(`${profile}: 10 situações novas processadas (order_index 11-20).`);
  }

  console.log(`\nParte 2: ${inserted} situações novas inseridas, ${updated} atualizadas.`);

  const { rows: counts } = await client.query(
    `select operational_profile, count(*) from public.phase2_prompts where part = 'part2' and is_active group by 1 order by 1`,
  );
  console.log("Pool final da Parte 2 por perfil:", counts);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
