// Substitui os áudios sintéticos (TTS) de teste da Fase 1 por gravações reais de
// comunicações ATC fornecidas pela Sabrina, com perguntas baseadas nas transcrições
// reais (transcricoes_audios.pdf). Uso único/manual: `node scripts/replace-phase1-audios.mjs`.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
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

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = env.SUPABASE_DB_URL;

const SOURCE_DIR =
  "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/ATC/Phase 1 - Audios";

const ITEMS = [
  {
    file: "audio01.mp3",
    title: "Fumaça na cabine — ACA782",
    category: "emergency_smoke",
    difficulty: "easy",
    transcript:
      "Mayday, mayday, mayday, ACA782, we have smoke in the cabin. ACA782, departure, radar contact, climb and maintain 5000, fly heading 180. Fly heading 180, climb 5000, ACA782.",
    prompt: "Qual emergência a aeronave ACA782 declarou?",
    option_a: "Fumaça na cabine",
    option_b: "Falha de motor",
    option_c: "Falta de combustível",
    correct_option: "a",
  },
  {
    file: "audio02.mp3",
    title: "Piloto incapacitado — BAW59T",
    category: "emergency_medical",
    difficulty: "medium",
    transcript:
      "BAW59T, just confirmation, did you declare mayday? BAW59T, affirm, mayday declared. Incapacitation and very poorly pilot, so we need assistance on arrival. We should... I hope to be on the ground in 15 minutes.",
    prompt: "Por que a aeronave BAW59T declarou emergência?",
    option_a: "Falha estrutural na aeronave",
    option_b: "Piloto incapacitado / muito mal",
    option_c: "Pane elétrica a bordo",
    correct_option: "b",
  },
  {
    file: "audio03.mp3",
    title: "Falha de motor — GTI8585",
    category: "technical_malfunction",
    difficulty: "easy",
    transcript:
      "GTI8585 heavy, contact departure 118.3. 18... declaring an emergency, GTI8585, engine failure, returning to the field. GTI8585 heavy, roger. Advise the airport in sight. RW04R or any runway, your choice, you are cleared to land, wind 060 at 9. GTI8585 heavy.",
    prompt: "Qual foi o motivo da emergência declarada pela GTI8585?",
    option_a: "Falha de motor",
    option_b: "Fumaça na cabine",
    option_c: "Colisão com pássaros",
    correct_option: "a",
  },
  {
    file: "audio04.mp3",
    title: "Surto no motor direito — PAL113",
    category: "technical_malfunction",
    difficulty: "medium",
    transcript:
      "SoCal departure, mayday mayday mayday, PAL113, we have an engine surge of the right engine, request immediately land. PAL113 heavy, departure, radar contact, maintain 5000 and which runway did you want?",
    prompt: "O que a aeronave PAL113 solicitou ao controle?",
    option_a: "Pousar imediatamente devido a problema no motor direito",
    option_b: "Subir para o nível de cruzeiro",
    option_c: "Aguardar em espera (holding)",
    correct_option: "a",
  },
  {
    file: "audio05.mp3",
    title: "Fogo a bordo — VDA3175",
    category: "emergency_fire",
    difficulty: "hard",
    transcript:
      "VDA3175 heavy, mayday mayday mayday, we have fire on board. Fire now is extinguished. We have fuel on board 10 hours and we have 13 souls on board. Copy, 10 hours of fuel, 13... souls on board. You have an engine fire and that is extinguished. Confirm? All correct, all correct, VDA3175, we are coming back for ILS RW07R.",
    prompt: "Quantas pessoas (\"souls on board\") a aeronave informou ter a bordo?",
    option_a: "10",
    option_b: "13",
    option_c: "7",
    correct_option: "b",
  },
  {
    file: "audio06.mp3",
    title: "Descida sem restrição — Antonov 3354",
    category: "navigation",
    difficulty: "medium",
    transcript:
      "Warsaw approach, good morning, Antonov 3354, descending to flight level 100 with information golf, direct WA533. Antonov 3354, approach, hello again, information golf correct, no speed restrictions, expect further descent in 18 miles. Copy that, Antonov 3354.",
    prompt: "O que o controle informa à Antonov 3354?",
    option_a: "Que não há restrição de velocidade e a próxima descida será autorizada em 18 milhas",
    option_b: "Que deve entrar em espera (holding) por 18 minutos",
    option_c: "Que a pista está fechada para pouso",
    correct_option: "a",
  },
  {
    file: "audio07.mp3",
    title: "Aproximação ILS — Antonov 3354",
    category: "navigation",
    difficulty: "easy",
    transcript:
      "Antonov 3354, descend altitude 3000 feet, QNH 1014, cleared ILS Y, approach runway 33, report established. Antonov 3354, descending 3000 feet, QNH 1014, cleared ILS Y runway 33, call you established.",
    prompt: "Para qual pista a aeronave foi autorizada a fazer a aproximação ILS?",
    option_a: "Pista 33",
    option_b: "Pista 04R",
    option_c: "Pista 28R",
    correct_option: "a",
  },
  {
    file: "audio08.mp3",
    title: "Objeto avistado em voo — AAL1997",
    category: "airspace_hazard",
    difficulty: "medium",
    transcript:
      "Tower, AAL1997, we just passed a guy in a jet pack. AAL1997, okay, thank you, were they off to your left side or right side? Off the left side, maybe 300 yards or so, about our altitude. Okay, AAL1997, contact tower 120.95, thanks today.",
    prompt: "O que a tripulação da AAL1997 avistou durante o voo?",
    option_a: "Um drone",
    option_b: "Um balão meteorológico",
    option_c: "Uma pessoa usando um jet pack",
    correct_option: "c",
  },
  {
    file: "audio09.mp3",
    title: "Arremetida no solo — AAL2543",
    category: "ground_operations",
    difficulty: "hard",
    transcript:
      "UAL2360, are you loading? We're ready out there, there's a plane in front of us and there's a guy on short final. UAL2348, runway 28R, line up and wait, move your aircraft. Runway 28R, line up and wait, UAL2348. United20... AAL2543, go around. UAL2348, is there a reason why you're not on the runway? Okay, we're finishing up the last checklist, we will be on the runway here in a second. AAL2543 is going around.",
    prompt: "O que aconteceu com a aeronave AAL2543?",
    option_a: "Foi liberada para pousar normalmente",
    option_b: "Recebeu instrução de arremeter (go around)",
    option_c: "Foi autorizada a entrar e aguardar na pista",
    correct_option: "b",
  },
  {
    file: "audio10.mp3",
    title: "Aeronave causou arremetidas — UAL2048",
    category: "traffic_conflict",
    difficulty: "hard",
    transcript:
      "UAL2051, fly runway heading, maintain 3000. Runway heading, 3000, UAL2551. UAL2048, you caused 2 go arounds, hold in position. Holding in position, UAL2348. AAL2543, 260 heading, 3100. 260 heading and 3100, AAL2543.",
    prompt: "Qual instrução o controle dá à aeronave que causou dois arremetidas (go arounds)?",
    option_a: "Aguardar na posição (hold in position)",
    option_b: "Decolar imediatamente",
    option_c: "Contatar a torre em outra frequência",
    correct_option: "a",
  },
];

async function upload(path, buffer) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/phase1-audios/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload falhou (${res.status}): ${body.slice(0, 300)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/phase1-audios/${path}`;
}

async function remove(paths) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/phase1-audios`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) {
    console.warn(`Aviso: falha ao remover arquivos antigos (${res.status}): ${await res.text()}`);
  }
}

function getDurationSeconds(filePath) {
  const out = execSync(`afinfo "${filePath}" | grep "estimated duration"`).toString();
  const match = out.match(/([\d.]+)\s*sec/);
  return match ? Math.round(parseFloat(match[1])) : null;
}

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  console.log("Removendo perguntas e áudios de teste (TTS) antigos...");
  await db.query("delete from public.phase1_questions");
  await db.query("delete from public.phase1_audios");
  await remove(Array.from({ length: 10 }, (_, i) => `seed-${i + 1}.mp3`));

  for (const [index, item] of ITEMS.entries()) {
    const filePath = `${SOURCE_DIR}/${item.file}`;
    const durationSeconds = getDurationSeconds(filePath);
    console.log(
      `[${index + 1}/${ITEMS.length}] ${item.file} -> ${item.title} (${durationSeconds}s, ${item.difficulty})`,
    );

    const buffer = readFileSync(filePath);
    const audioUrl = await upload(item.file, buffer);

    const audioResult = await db.query(
      `insert into public.phase1_audios
        (title, audio_url, transcript, difficulty, category, accent, duration_seconds, is_active)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       returning id`,
      [item.title, audioUrl, item.transcript, item.difficulty, item.category, "mixed", durationSeconds],
    );
    const audioId = audioResult.rows[0].id;

    await db.query(
      `insert into public.phase1_questions
        (audio_id, prompt, option_a, option_b, option_c, correct_option, is_active)
       values ($1, $2, $3, $4, $5, $6, true)`,
      [audioId, item.prompt, item.option_a, item.option_b, item.option_c, item.correct_option],
    );
  }

  await db.end();
  console.log(`\nConcluído: ${ITEMS.length} áudios reais + perguntas inseridos.`);
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
