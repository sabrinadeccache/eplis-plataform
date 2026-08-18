// Adiciona mais 10 situações da Parte 2 por perfil operacional (TWR, APP,
// ACC, COpM), levando o pool de 20 para 30 por perfil — a pedido da Sabrina,
// pra reduzir a chance do usuário decorar o pool com o tempo. Temas
// deliberadamente distintos dos 20 já existentes (ver
// add-phase2-part2-situations-batch2.mjs) pra maximizar variedade.
//
// Aditivo — não apaga nem mexe nas 20 situações já existentes de cada
// perfil. UPSERT por (operational_profile, order_index): as novas ocupam
// order_index 21-30. Idempotente, seguro rodar de novo.
// Uso: `node scripts/add-phase2-part2-situations-batch3.mjs`
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
  "A pilot reports a fuel spill on the ramp near the terminal. What's the situation?",
  "An aircraft requests priority landing because a passenger is giving birth onboard. What's the situation?",
  "A tug pushing back an aircraft loses its brakes and drifts toward an active taxiway. What's the situation?",
  "Lightning strikes near the field force a ground stop for all fueling operations. What's the situation?",
  "A pilot reports a suspected drone sighting near the approach path. What's the situation?",
  "An aircraft lands without clearance after a frequency mix-up. What's the situation?",
  "A runway inspection reveals debris (FOD) just before a departure is cleared. What's the situation?",
  "An aircraft declares minimum fuel while waiting in a long departure queue. What's the situation?",
  "Wildlife is spotted near the runway threshold during a busy arrival push. What's the situation?",
  "An aircraft reports a cracked windshield during taxi and requests to return to the gate. What's the situation?",
];

const APP = [
  "An aircraft reports a hydraulic failure and requests extra maneuvering room before final approach. What's the situation?",
  "Two aircraft converge during a simultaneous go-around and require an avoidance vector. What's the situation?",
  "A pilot requests a lower approach speed due to a flap malfunction. What's the situation?",
  "An aircraft's transponder stops transmitting altitude information while being vectored. What's the situation?",
  "A sudden wind shear alert is issued for the final approach segment. What's the situation?",
  "An aircraft requests to hold due to a family medical emergency being coordinated on the ground. What's the situation?",
  "A crew reports unreliable airspeed indications while being vectored for approach. What's the situation?",
  "Two aircraft on parallel approaches report a loss of lateral separation. What's the situation?",
  "An aircraft requests priority approach after a bird strike cracks a cockpit window. What's the situation?",
  "A go-around is triggered when a vehicle is spotted on the runway during short final. What's the situation?",
];

const ACC = [
  "An aircraft requests an emergency descent after a fire warning in the cargo hold. What's the situation?",
  "Two aircraft on the same route report a TCAS resolution advisory at cruise altitude. What's the situation?",
  "A crew reports a stuck flight control surface and requests a lower, slower cruise. What's the situation?",
  "Severe icing at cruise altitude forces an aircraft to request an immediate altitude change. What's the situation?",
  "An aircraft reports a hydraulic system failure and requests priority routing to the nearest suitable airport. What's the situation?",
  "A military exercise unexpectedly closes part of your sector's airspace during heavy traffic. What's the situation?",
  "An aircraft reports a bomb threat received in flight and requests priority handling. What's the situation?",
  "Two aircraft request the same oceanic track at the same time due to a scheduling conflict. What's the situation?",
  "A crew suspects contaminated fuel and requests the nearest suitable diversion. What's the situation?",
  "An aircraft loses all communication and navigation equipment at the same time. What's the situation?",
];

const COPM = [
  "A renegade scenario is declared after an aircraft threatens to be used as a weapon. What's the situation?",
  "An unidentified slow-moving target is detected over a sensitive military installation. What's the situation?",
  "A friendly aircraft's IFF malfunctions during a live-fire exercise, creating identification uncertainty. What's the situation?",
  "Coordination is required to deconflict a civil air corridor with an ongoing air-to-air refueling exercise. What's the situation?",
  "An aircraft entering national airspace fails to file the required flight plan for a border crossing. What's the situation?",
  "A quick reaction alert is triggered by a fast, unannounced approach toward national airspace. What's the situation?",
  "Two unidentified tracks merge into one, complicating identification for the intercept mission. What's the situation?",
  "A civil aircraft's emergency squawk coincides with a scheduled military live exercise, causing ambiguity. What's the situation?",
  "An interceptor reports the intercepted aircraft is behaving erratically and may be under duress. What's the situation?",
  "Cross-border coordination is required after an unidentified aircraft crosses into neighboring airspace during a joint patrol. What's the situation?",
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
      const orderIndex = i + 21; // continua depois das 20 já existentes (1-20)
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
    console.log(`${profile}: 10 situações novas processadas (order_index 21-30).`);
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
