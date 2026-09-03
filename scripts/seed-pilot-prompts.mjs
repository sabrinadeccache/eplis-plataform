// Conteúdo inicial da trilha do piloto (SDEA). Partes 2 a 4 vêm das 5 provas
// reais levantadas: 1 prova-modelo oficial da ANAC (fixed_wing, "Modelo
// SDEA.pdf") + 4 provas reais de helicóptero (rotary_wing, "Test 1-4
// helicopter ICAO 2024"). Parte 1 usa um pool próprio de 30 perguntas abertas
// (pool 'general', agnóstico ao tipo de aeronave) escrito pela Sabrina —
// substituiu as 15 originais das provas-modelo. Ampliação das Partes 2 a 4 pra
// "dezenas por parte" fica pra uma rodada separada (decisão fechada com a
// Sabrina), igual ao histórico do EPLIS.
//
// Idempotente via UPSERT (nunca delete-and-reinsert, convenção do CLAUDE.md):
// Parte 1 casa por prompt_text (pool 'general', compartilhado entre
// perfis); Partes 2 e 3 casam por (aircraft_type, order_index) — cada prova
// contribui um bloco contíguo de order_index; Parte 4 casa por image_url.
// Item que sair da lista é só desativado (is_active = false), nunca apagado.
//
// Uso: `node scripts/seed-pilot-prompts.mjs`. Rode ANTES:
//   - scripts/upload-pilot-part2-part4-images.mjs (fotos de complicação da Parte 2)
//   - scripts/upload-pilot-part4-images.mjs (13+10 fotos da Parte 4)
// Rode DEPOIS:
//   - scripts/generate-pilot-prompt-audio.mjs (áudios de rádio das Partes 2 e 3)
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { part4Url } from "./upload-pilot-part4-images.mjs";

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

const PART1 = [
  // Bloco 1 — conhecimento operacional / técnico (perguntas 1-10)
  "What are the main causes of flight delays?",
  "When do pilots decide to divert to an alternate aerodrome?",
  "How do crew members handle a passenger who becomes ill during a flight?",
  "What kind of weather conditions can make a landing difficult?",
  "Why is standard phraseology so important in radio communications?",
  "What does a pilot check during the walk-around inspection?",
  "How does fatigue affect a pilot's performance?",
  "What happens when an aircraft experiences a bird strike?",
  "Who is responsible for the safety of an aircraft on the ground?",
  "How do pilots and air traffic controllers avoid misunderstandings?",
  // Bloco 2 — experiência pessoal / carreira (perguntas 11-20)
  "How did you become interested in aviation?",
  "Tell me about your first solo flight.",
  "Have you ever faced a difficult weather situation during a flight?",
  "What was the most challenging part of your flight training?",
  "Describe a flight you will never forget.",
  "Have you ever had a problem communicating in English during a flight?",
  "Tell me about an interesting airport you have flown from.",
  "Was there a moment when you had to make a quick decision in the cockpit?",
  "How was your experience working with different crew members?",
  "Have you ever witnessed or heard about an incident at an airport?",
  // Bloco 3 — opinião / futuro da aviação (perguntas 21-30)
  "In your opinion, what is the biggest safety challenge in aviation today?",
  "Do you think automation makes flying safer? Why?",
  "What would you do if you lost radio contact with ATC?",
  "How do you think pilot training will change in the next twenty years?",
  "In your opinion, should airlines invest more in crew rest facilities?",
  "What would you do if a passenger became aggressive during a flight?",
  "Do you believe unmanned aircraft will replace pilots one day?",
  "How can aviation become more environmentally friendly?",
  "If you could improve one thing at the airport where you work, what would it be?",
  "What advice would you give to someone who wants to become a pilot?",
];

// Parte 2 (87 situacoes) e Parte 3 (38 dialogos) vem de
// scripts/pilot-content-part234.mjs, gerado das planilhas questions-map*.xlsx do
// Material Didatico. Parte 2: contexto (prompt_text) + AUDIO 1 do controlador
// (atc_audio_text) + narracao do imprevisto (complication_text) + AUDIO 2
// (atc_followup_audio_text). expected_* ficam null (a IA da trilha do piloto nao
// julga fraseologia). Parte 3: prompt_text = transcricao com rotulos pilot:/atc:,
// discussion_question = pergunta do audio, comparison_question = comparacao final.
import {
  PART2_FIXED_WING,
  PART2_ROTARY_WING,
  PART3_GENERAL,
} from "./pilot-content-part234.mjs";

// Parte 4 — pool de fotos IA-geradas fornecido pela Sabrina (13 avião + 10
// helicóptero, ver scripts/upload-pilot-part4-images.mjs). Só a AFIRMAÇÃO
// (agree_disagree_statement) é específica da foto; a descrição, as hipóteses de
// antes/depois e as 2 perguntas de discussão são FIXAS e vivem no runner
// (PART4_* em src/components/sdea/pilot-interview-runner.tsx), conforme
// orientação da Sabrina e o "Modelo SDEA com anotações". Por isso
// discussion_question / discussion_question_2 ficam null aqui.
const PART4_PROMPT_TEXT = "Please describe this picture to me.";

const PART4_FIXED_WING = [
  "An engine fire on the ground is always easier to handle than one that starts in flight.",
  "Airport congestion is a commercial issue and has little effect on flight safety.",
  "Most runway excursions could be prevented if crews were quicker to decide to go around or divert.",
  "With today's weather radar and forecasting, flying into severe weather is entirely the flight crew's responsibility.",
  "Medical flights should always be given priority over commercial traffic, whatever the delay to other aircraft.",
  "In uncontrolled airspace, see-and-avoid alone is not enough to prevent mid-air collisions.",
  "A pilot must always follow a TCAS resolution advisory, even when it goes against an air traffic control instruction.",
  "Reducing the vertical separation between aircraft at cruising level has made busy airspace less safe.",
  "The pressure to keep turnaround times short is one of the main causes of ground handling mistakes.",
  "Any passenger who becomes violent on board should be banned from flying with that airline for life.",
  "A first officer should openly challenge the captain whenever they believe a decision is unsafe.",
  "A commercial flight should divert whenever a passenger becomes seriously ill, no matter the cost to the airline.",
  "A burst tyre detected during the takeoff roll should always lead to a rejected takeoff.",
].map((statement, i) => ({
  prompt_text: PART4_PROMPT_TEXT,
  image_url: part4Url("fixed_wing", i + 1),
  discussion_question: null,
  discussion_question_2: null,
  agree_disagree_statement: statement,
}));

const PART4_ROTARY_WING = [
  "The benefits of helicopter medical services outweigh the extra risks of landing away from proper airfields.",
  "Transferring a critically ill patient between hospitals is safer by helicopter than by road ambulance.",
  "Frequent training exercises matter more than advanced equipment for the success of a rescue operation.",
  "For fighting wildfires, helicopters are more useful than fixed-wing water bombers.",
  "In an air rescue mission, the speed of the response matters more than any other factor.",
  "Firefighting aircraft should stop operating when smoke reduces visibility below safe limits.",
  "Flying close to terrain in poor visibility is an acceptable risk during firefighting operations.",
  "Helicopter mountain rescue should only be carried out by crews with specific mountain training.",
  "During a hoist operation, it is the winch operator, not the pilot, who is effectively in control of the helicopter.",
  "In a rescue at sea, a helicopter is always a better choice than a lifeboat.",
].map((statement, i) => ({
  prompt_text: PART4_PROMPT_TEXT,
  image_url: part4Url("rotary_wing", i + 1),
  discussion_question: null,
  discussion_question_2: null,
  agree_disagree_statement: statement,
}));

const PART2_DURATION = 90;
const PART3_DURATION = 90;
const PART4_DURATION = 90;

async function upsertPart1(client, text) {
  const { rows } = await client.query(
    `update public.pilot_prompts
       set expected_duration_seconds = 60, is_active = true
     where part = 'part1' and aircraft_type = 'general' and prompt_text = $1
     returning id`,
    [text],
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.pilot_prompts (part, aircraft_type, prompt_text, expected_duration_seconds, is_active)
     values ('part1', 'general', $1, 60, true)
     returning id`,
    [text],
  );
  return inserted.rows[0].id;
}

async function upsertPart2(client, aircraftType, orderIndex, item) {
  const values = [
    item.prompt_text,
    item.atc_audio_text,
    item.expected_readback,
    item.complication_text,
    item.complication_image_url,
    item.expected_reaction,
    item.atc_followup_audio_text,
    item.expected_confirmation,
    PART2_DURATION,
    aircraftType,
    orderIndex,
  ];
  const { rows } = await client.query(
    `update public.pilot_prompts
       set prompt_text = $1, atc_audio_text = $2, expected_readback = $3, complication_text = $4,
           complication_image_url = $5, expected_reaction = $6, atc_followup_audio_text = $7,
           expected_confirmation = $8, expected_duration_seconds = $9, is_active = true
     where part = 'part2' and aircraft_type = $10 and order_index = $11
     returning id`,
    values,
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.pilot_prompts
       (part, aircraft_type, order_index, prompt_text, atc_audio_text, expected_readback, complication_text,
        complication_image_url, expected_reaction, atc_followup_audio_text, expected_confirmation,
        expected_duration_seconds, is_active)
     values ('part2', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
     returning id`,
    [
      aircraftType,
      orderIndex,
      item.prompt_text,
      item.atc_audio_text,
      item.expected_readback,
      item.complication_text,
      item.complication_image_url,
      item.expected_reaction,
      item.atc_followup_audio_text,
      item.expected_confirmation,
      PART2_DURATION,
    ],
  );
  return inserted.rows[0].id;
}

async function upsertPart3(client, aircraftType, orderIndex, item) {
  const { rows } = await client.query(
    `update public.pilot_prompts
       set prompt_text = $1, discussion_question = $2, comparison_question = $3,
           expected_duration_seconds = $4, is_active = true
     where part = 'part3' and aircraft_type = $5 and order_index = $6
     returning id`,
    [
      item.prompt_text,
      item.discussion_question,
      item.comparison_question,
      PART3_DURATION,
      aircraftType,
      orderIndex,
    ],
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.pilot_prompts
       (part, aircraft_type, order_index, prompt_text, discussion_question, comparison_question,
        expected_duration_seconds, is_active)
     values ('part3', $1, $2, $3, $4, $5, $6, true)
     returning id`,
    [
      aircraftType,
      orderIndex,
      item.prompt_text,
      item.discussion_question,
      item.comparison_question,
      PART3_DURATION,
    ],
  );
  return inserted.rows[0].id;
}

async function upsertPart4(client, aircraftType, orderIndex, item) {
  const { rows } = await client.query(
    `update public.pilot_prompts
       set prompt_text = $1, discussion_question = $2, discussion_question_2 = $3,
           agree_disagree_statement = $4, expected_duration_seconds = $5, order_index = $6,
           is_active = true
     where part = 'part4' and aircraft_type = $7 and image_url = $8
     returning id`,
    [
      item.prompt_text,
      item.discussion_question,
      item.discussion_question_2,
      item.agree_disagree_statement,
      PART4_DURATION,
      orderIndex,
      aircraftType,
      item.image_url,
    ],
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.pilot_prompts
       (part, aircraft_type, order_index, image_url, prompt_text, discussion_question,
        discussion_question_2, agree_disagree_statement, expected_duration_seconds, is_active)
     values ('part4', $1, $2, $3, $4, $5, $6, $7, $8, true)
     returning id`,
    [
      aircraftType,
      orderIndex,
      item.image_url,
      item.prompt_text,
      item.discussion_question,
      item.discussion_question_2,
      item.agree_disagree_statement,
      PART4_DURATION,
    ],
  );
  return inserted.rows[0].id;
}

async function deactivateStale(client, part, aircraftType, keptIds) {
  await client.query(
    `update public.pilot_prompts
       set is_active = false
     where part = $1 and aircraft_type = $2 and not (id = any($3::uuid[]))`,
    [part, aircraftType, keptIds],
  );
}

async function main() {
  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const part1Ids = [];
  for (const text of PART1) {
    part1Ids.push(await upsertPart1(client, text));
  }
  await deactivateStale(client, "part1", "general", part1Ids);

  const part2FixedIds = [];
  for (let i = 0; i < PART2_FIXED_WING.length; i++) {
    part2FixedIds.push(await upsertPart2(client, "fixed_wing", i + 1, PART2_FIXED_WING[i]));
  }
  await deactivateStale(client, "part2", "fixed_wing", part2FixedIds);

  const part2RotaryIds = [];
  for (let i = 0; i < PART2_ROTARY_WING.length; i++) {
    part2RotaryIds.push(await upsertPart2(client, "rotary_wing", i + 1, PART2_ROTARY_WING[i]));
  }
  await deactivateStale(client, "part2", "rotary_wing", part2RotaryIds);

  // Parte 3 passou a ser 'general' (roteiro novo não segmenta por tipo de
  // aeronave, igual à Parte 1). Desativa o conteúdo antigo separado por perfil.
  await client.query(
    `update public.pilot_prompts set is_active = false
     where part = 'part3' and aircraft_type in ('fixed_wing', 'rotary_wing')`,
  );
  const part3Ids = [];
  for (let i = 0; i < PART3_GENERAL.length; i++) {
    part3Ids.push(await upsertPart3(client, "general", i + 1, PART3_GENERAL[i]));
  }
  await deactivateStale(client, "part3", "general", part3Ids);

  const part4FixedIds = [];
  for (let i = 0; i < PART4_FIXED_WING.length; i++) {
    part4FixedIds.push(await upsertPart4(client, "fixed_wing", i + 1, PART4_FIXED_WING[i]));
  }
  await deactivateStale(client, "part4", "fixed_wing", part4FixedIds);

  const part4RotaryIds = [];
  for (let i = 0; i < PART4_ROTARY_WING.length; i++) {
    part4RotaryIds.push(await upsertPart4(client, "rotary_wing", i + 1, PART4_ROTARY_WING[i]));
  }
  await deactivateStale(client, "part4", "rotary_wing", part4RotaryIds);

  console.log(
    `Seed concluído: ${PART1.length} Parte 1 (general), ${part2FixedIds.length} Parte 2 fixed_wing, ` +
      `${part2RotaryIds.length} Parte 2 rotary_wing, ${part3Ids.length} Parte 3 (general), ` +
      `${part4FixedIds.length} Parte 4 fixed_wing, ${part4RotaryIds.length} Parte 4 rotary_wing.`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
