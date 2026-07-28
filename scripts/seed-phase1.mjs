// Gera áudios sintéticos (OpenAI TTS) para popular phase1_audios/phase1_questions
// com conteúdo de teste realista, enquanto o banco de áudios oficial do EPLIS não
// existe. Uso único/manual: `node scripts/seed-phase1.mjs`. Não faz parte do build
// da aplicação — não está referenciado em nenhum código de runtime.
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

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = env.OPENAI_API_KEY;
const DB_URL = env.SUPABASE_DB_URL;

if (!SUPABASE_URL || !SERVICE_KEY || !OPENAI_KEY || !DB_URL) {
  console.error("Faltam variáveis em .env.local (Supabase URL/service key, OpenAI key, DB url).");
  process.exit(1);
}

const VOICES = ["onyx", "echo", "fable", "nova", "shimmer"];

const ITEMS = [
  {
    title: "Desvio por tempestade",
    category: "weather",
    difficulty: "medium",
    transcript:
      "November Alpha Bravo Charlie, be advised, there's an area of severe thunderstorm activity twenty miles ahead on your route, tops estimated at flight level four four zero. Suggest deviation twenty degrees right, own navigation, report clear of weather.",
    prompt: "Qual desvio o controle sugere para a aeronave?",
    option_a: "20 graus à esquerda",
    option_b: "20 graus à direita",
    option_c: "Manter a rota atual",
    correct_option: "b",
  },
  {
    title: "Falha hidráulica",
    category: "technical_malfunction",
    difficulty: "hard",
    transcript:
      "Approach, Speedbird two three four, we have a hydraulic system one failure, requesting priority handling and a longer final for runway two seven, we may have reduced braking capability.",
    prompt: "Qual sistema da aeronave está com falha?",
    option_a: "Sistema elétrico",
    option_b: "Sistema hidráulico",
    option_c: "Sistema de pressurização",
    correct_option: "b",
  },
  {
    title: "Emergência médica a bordo",
    category: "medical_emergency",
    difficulty: "easy",
    transcript:
      "Center, this is Delta niner one two, we have a passenger experiencing chest pain and difficulty breathing, requesting descent and diversion to the nearest suitable airport with medical facilities.",
    prompt: "Qual é o motivo do pedido de desvio?",
    option_a: "Problema técnico na aeronave",
    option_b: "Emergência médica de um passageiro",
    option_c: "Falta de combustível",
    correct_option: "b",
  },
  {
    title: "Passageiro perturbador",
    category: "security",
    difficulty: "medium",
    transcript:
      "Tower, United four five six, we have a disruptive passenger on board who has become aggressive with the cabin crew, we may require police assistance on arrival at the gate.",
    prompt: "O que a tripulação está solicitando na chegada?",
    option_a: "Reabastecimento prioritário",
    option_b: "Assistência da polícia",
    option_c: "Inspeção de manutenção",
    correct_option: "b",
  },
  {
    title: "Colisão com pássaros",
    category: "wildlife_hazard",
    difficulty: "medium",
    transcript:
      "Tower, Cessna six three two, we struck a flock of birds on departure, we have visible damage to the left engine cowling, requesting immediate return to the field.",
    prompt: "O que aconteceu durante a decolagem?",
    option_a: "Colisão com pássaros",
    option_b: "Falha no trem de pouso",
    option_c: "Perda de comunicação",
    correct_option: "a",
  },
  {
    title: "Combustível mínimo",
    category: "fuel",
    difficulty: "hard",
    transcript:
      "Approach, Jetstream seven zero one, due to holding delays we are now declaring minimum fuel, we will advise if the situation develops into a fuel emergency.",
    prompt: "O que o piloto está declarando ao controle?",
    option_a: "Combustível mínimo",
    option_b: "Combustível esgotado",
    option_c: "Excesso de combustível a bordo",
    correct_option: "a",
  },
  {
    title: "Aguardando degelo",
    category: "ground_operations",
    difficulty: "easy",
    transcript:
      "Ground, American two two one, we're ready for de-icing, current holdover time estimate is fifteen minutes, please advise the sequence.",
    prompt: "O que a aeronave está aguardando?",
    option_a: "Autorização de pouso",
    option_b: "Procedimento de degelo",
    option_c: "Troca de pista",
    correct_option: "b",
  },
  {
    title: "Incursão de pista",
    category: "runway_incursion",
    difficulty: "hard",
    transcript:
      "Tower, be advised, there is a vehicle crossing runway two seven without clearance. Go around, go around.",
    prompt: "Qual instrução é dada à aeronave?",
    option_a: "Continuar a aproximação",
    option_b: "Arremeter (go around)",
    option_c: "Aguardar em espera (holding)",
    correct_option: "b",
  },
  {
    title: "Perda de comunicação",
    category: "communication_failure",
    difficulty: "medium",
    transcript:
      "Center, Air Canada eight eight one, we experienced a temporary loss of very high frequency communication for approximately ten minutes, we are now re-established and squawking normal.",
    prompt: "Qual problema a aeronave relata ter enfrentado?",
    option_a: "Perda de comunicação por rádio",
    option_b: "Falha nos instrumentos de navegação",
    option_c: "Falha no transponder",
    correct_option: "a",
  },
  {
    title: "Alerta de tráfego (TCAS)",
    category: "traffic_conflict",
    difficulty: "hard",
    transcript:
      "Approach, we just received a TCAS resolution advisory, climbing now to avoid conflicting traffic, will advise when clear.",
    prompt: "Por que a aeronave está subindo?",
    option_a: "Para evitar uma tempestade",
    option_b: "Por instrução do controlador",
    option_c: "Devido a um alerta de tráfego (TCAS)",
    correct_option: "c",
  },
];

async function synthesize(text, voice) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice,
      input: text,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TTS falhou (${res.status}): ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function upload(path, buffer) {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/phase1-audios/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "audio/mpeg",
        "x-upsert": "true",
      },
      body: buffer,
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload falhou (${res.status}): ${body.slice(0, 300)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/phase1-audios/${path}`;
}

function estimateDurationSeconds(text) {
  const words = text.trim().split(/\s+/).length;
  return Math.round(words / 2.3);
}

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  for (const [index, item] of ITEMS.entries()) {
    const voice = VOICES[index % VOICES.length];
    console.log(`[${index + 1}/${ITEMS.length}] gerando áudio: ${item.title} (voz: ${voice})`);

    const audioBuffer = await synthesize(item.transcript, voice);
    const path = `seed-${index + 1}.mp3`;
    const audioUrl = await upload(path, audioBuffer);
    const durationSeconds = estimateDurationSeconds(item.transcript);

    const audioResult = await db.query(
      `insert into public.phase1_audios
        (title, audio_url, transcript, difficulty, category, accent, duration_seconds, is_active)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       returning id`,
      [item.title, audioUrl, item.transcript, item.difficulty, item.category, "american", durationSeconds],
    );
    const audioId = audioResult.rows[0].id;

    await db.query(
      `insert into public.phase1_questions
        (audio_id, prompt, option_a, option_b, option_c, correct_option, is_active)
       values ($1, $2, $3, $4, $5, $6, true)`,
      [audioId, item.prompt, item.option_a, item.option_b, item.option_c, item.correct_option],
    );

    console.log(`  -> ok (audio_id=${audioId}, ${durationSeconds}s, url=${audioUrl})`);
  }

  await db.end();
  console.log(`\nConcluído: ${ITEMS.length} áudios + perguntas inseridos.`);
}

main().catch((err) => {
  console.error("Erro no seed:", err.message);
  process.exit(1);
});
