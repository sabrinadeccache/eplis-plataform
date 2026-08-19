// Substitui o pool placeholder de 6 perguntas da Parte 3 (tráfego aéreo e
// aviação em geral, opinião/experiência do examinando) por um pool real de
// 120 perguntas abertas, perfil 'general' (Parte 3 não é segmentada por
// perfil operacional). Metade "concreta" (situações do próprio trabalho do
// examinando) e metade "abstrata" (opiniões/reflexões mais amplas sobre a
// profissão/aviação) — spec oficial exige que as 2 primeiras perguntas de
// cada tentativa sejam concretas e as 2 últimas, abstratas (ver
// docs/database-schema.md, tabela phase2_prompts). Reaproveitamos a coluna
// `order_index` (já existente, antes só usada pela Parte 2) como marcador de
// nível — 1 = concreta, 2 = abstrata — não como posição exata; o sorteio em
// src/services/simulations/phase2/queries.ts escolhe 2 de cada grupo e
// concatena concretas antes de abstratas.
// Idempotente via UPSERT casando por prompt_text — nunca apaga linha em uso
// por phase2_responses, só desativa (is_active = false) o que sair da lista.
// Uso: `node scripts/seed-phase2-part3-pool.mjs`.
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
const CONCRETE_TIER = 1;
const ABSTRACT_TIER = 2;

// Concretas: sobre a experiência real e específica do examinando no próprio
// trabalho — algo que ele viveu ou faz de fato.
const CONCRETE = [
  "Describe the busiest hour at your facility.",
  "Describe the last time you had to deal with bad weather at work.",
  "Tell me about a specific procedure you follow when traffic is heavy.",
  "Describe a shift where communication was especially important.",
  "Tell me about a piece of equipment failure you have experienced or heard about.",
  "Describe how you coordinate with a neighboring sector or unit.",
  "Tell me about a time you had to adjust a plan quickly because of traffic.",
  "Describe how a typical handover works at your facility.",
  "Tell me about a specific safety procedure you use regularly.",
  "Describe a moment when teamwork solved a problem during a shift.",
  "Tell me about a time you had to give clear instructions under pressure.",
  "Describe how your facility handles a runway or airspace closure.",
  "Tell me about a specific training exercise you found useful.",
  "Describe how you double-check information before passing it on.",
  "Tell me about a time a language or communication issue came up at work.",
  "Describe a situation where you had to prioritize between two urgent tasks.",
  "Tell me about how your facility prepares for a shift change during high traffic.",
  "Describe a specific rule or procedure that exists because of a past incident.",
  "Tell me about a time you had to correct a mistake quickly during a shift.",
  "Describe how your team practices for emergency scenarios.",
  "Tell me about a specific tool or checklist you rely on every day.",
  "Describe a moment when clear phraseology made a real difference.",
  "Tell me about a time you had to manage several aircraft or tasks at once.",
  "Describe how your facility handles a sudden increase in traffic.",
  "Tell me about a specific coordination call you make often.",
  "Describe a time you had to explain a technical issue to a colleague.",
  "Tell me about how new staff are trained at your facility.",
  "Describe a specific situation that tested your decision-making skills.",
  "Tell me about a piece of feedback you received that changed how you work.",
  "Describe a recent shift that was more demanding than usual.",
  "Tell me about a specific safety check you perform before starting a task.",
  "Describe how weather information reaches you during a shift.",
  "Tell me about a time you had to work with a colleague you did not know well.",
  "Describe a specific moment when quick thinking prevented a problem.",
  "Tell me about how your facility logs or reports an unusual event.",
  "Describe a time you had to repeat or clarify an instruction to be understood.",
  "Tell me about a specific drill or simulation your facility runs.",
  "Describe how you confirm that critical information has been received.",
  "Tell me about a time technology helped you resolve a problem quickly.",
  "Describe a specific situation where fatigue affected your shift.",
  "Tell me about how your facility handles a communication equipment failure.",
  "Describe a moment when you had to stay calm during an unexpected event.",
  "Tell me about a specific procedure that changed since you started working.",
  "Describe how you and your colleagues debrief after a demanding shift.",
  "Tell me about a time you noticed a potential problem before it happened.",
  "Describe a specific example of good teamwork you witnessed recently.",
  "Tell me about how your facility manages a shift with reduced staff.",
  "Describe a moment when you had to trust a colleague's judgement completely.",
  "Tell me about a specific instance of using backup or manual procedures.",
  "Describe how your facility handles reports of unusual aircraft behavior.",
  "Tell me about a time a routine task turned into something more serious.",
  "Describe the last time you updated or reviewed a procedure at work.",
  "Tell me about a specific way your facility keeps staff informed of changes.",
  "Describe a moment when patience was essential during a shift.",
  "Tell me about a specific challenge with equipment you use daily.",
  "Describe how your facility handles overlapping emergencies.",
  "Tell me about a time you had to adapt to a sudden change in plan.",
  "Describe a specific example of clear coordination between two teams.",
  "Tell me about the last time you took part in a safety review.",
  "Describe a moment when your training was put to a real test.",
];

// Abstratas: opiniões e reflexões mais amplas sobre a profissão/aviação em
// geral, não necessariamente ligadas a um episódio específico do candidato.
const ABSTRACT = [
  "What role does teamwork play in aviation safety in general?",
  "How does stress affect communication in emergencies?",
  "What makes a good leader in high-pressure situations?",
  "How important is trust between colleagues in high-stakes professions?",
  "What do you think is the biggest challenge facing aviation today?",
  "How do you think automation will change aviation in the future?",
  "What role should artificial intelligence play in air traffic management?",
  "How important is human judgement compared to technology in aviation?",
  "What do you think makes a safety culture truly effective?",
  "How should the aviation industry prepare the next generation of professionals?",
  "What responsibility does the individual have for overall system safety?",
  "How do cultural differences affect communication in international aviation?",
  "What do you think is the value of standardized phraseology worldwide?",
  "How should fatigue be managed across the aviation industry?",
  "What ethical considerations come up in high-pressure professions like this one?",
  "How important is continuous training throughout a career in aviation?",
  "What do you think the aviation industry could learn from other high-risk industries?",
  "How should mistakes be handled in a system where safety is critical?",
  "What role does mental health play in professions like air traffic control or piloting?",
  "How do you see the balance between efficiency and safety in aviation?",
  "What do you think is the most important quality for someone in a safety-critical role?",
  "How should the industry adapt to a growing volume of air traffic worldwide?",
  "What impact do you think climate change will have on aviation in the coming decades?",
  "How important is international cooperation in maintaining aviation safety?",
  "What do you think about the idea of remote or digital control towers?",
  "How should new technology be introduced without compromising safety?",
  "What do you think is the future of English as the language of aviation?",
  "How should the industry handle the gap between experienced and new professionals?",
  "What do you think motivates people to choose high-responsibility careers like this one?",
  "How important is public trust for the aviation industry as a whole?",
  "What do you think about the increasing use of simulation in training?",
  "How should organizations balance productivity with employee well-being?",
  "What role does regulation play in keeping aviation safe worldwide?",
  "How do you think decision-making under pressure can be taught effectively?",
  "What do you think is the biggest misconception the public has about aviation safety?",
  "How should the industry respond when a serious incident happens elsewhere in the world?",
  "What do you think is the relationship between experience and confidence in this field?",
  "How important is clear communication compared to technical skill in high-risk jobs?",
  "What do you think will be the biggest change in aviation over the next twenty years?",
  "How should leadership adapt in professions with irregular hours and high stress?",
  "What do you think about the growing role of data and analytics in safety management?",
  "How do you see the role of intuition versus procedure in critical decisions?",
  "What do you think makes some organizations more resilient to crises than others?",
  "How should the industry approach diversity and inclusion in safety-critical roles?",
  "What do you think about the idea that safety is everyone's responsibility, not just a few?",
  "How important do you think redundancy and backup systems are for overall safety?",
  "What do you think the ideal relationship between humans and automation looks like?",
  "How should professionals in this field cope with the pressure of high responsibility?",
  "What do you think is lost or gained when a task becomes fully automated?",
  "How should the industry prepare for unexpected global events, like pandemics or conflicts?",
  "What do you think is the value of learning from near-misses, not just accidents?",
  "How important is transparency when something goes wrong in a safety-critical system?",
  "What do you think the next generation of professionals will need that previous generations did not?",
  "How should organizations measure success beyond just safety statistics?",
  "What do you think about the balance between individual initiative and strict procedure?",
  "How important is empathy in professions that deal with high-stress situations?",
  "What do you think will change about training methods in the next decade?",
  "How should the aviation community handle disagreement about safety priorities?",
  "What do you think is the most undervalued skill in high-responsibility professions?",
  "How do you imagine the profession changing for someone starting their career today?",
];

async function upsertByText(client, part, text, tier) {
  const { rows } = await client.query(
    `update public.phase2_prompts
       set expected_duration_seconds = $1, order_index = $2, is_active = true
     where part = $3 and operational_profile = 'general' and prompt_text = $4
     returning id`,
    [SECONDS, tier, part, text],
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.phase2_prompts
       (part, operational_profile, prompt_text, expected_duration_seconds, order_index, is_active)
     values ($1, 'general', $2, $3, $4, true)
     returning id`,
    [part, text, SECONDS, tier],
  );
  return inserted.rows[0].id;
}

async function deactivateStale(client, part, keptIds) {
  await client.query(
    `update public.phase2_prompts
       set is_active = false
     where part = $1 and operational_profile = 'general' and not (id = any($2::uuid[]))`,
    [part, keptIds],
  );
}

async function main() {
  const all = [...CONCRETE, ...ABSTRACT];
  const unique = new Set(all);
  if (unique.size !== all.length) {
    throw new Error("PART3 (concreta+abstrata) tem perguntas duplicadas — corrija antes de rodar.");
  }

  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const keptIds = [];
  for (const text of CONCRETE) {
    keptIds.push(await upsertByText(client, "part3", text, CONCRETE_TIER));
  }
  for (const text of ABSTRACT) {
    keptIds.push(await upsertByText(client, "part3", text, ABSTRACT_TIER));
  }
  await deactivateStale(client, "part3", keptIds);

  console.log(
    `Seed concluído: ${CONCRETE.length} concretas + ${ABSTRACT.length} abstratas = ${all.length} perguntas ativas na Parte 3 (pool 'general').`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
