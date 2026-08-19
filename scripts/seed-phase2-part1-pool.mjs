// Substitui o pool placeholder de 6 perguntas da Parte 1 (dia a dia
// profissional e carreira do examinando) por um pool real de 120 perguntas
// abertas, perfil 'general' (Parte 1 não é segmentada por perfil
// operacional). Idempotente via UPSERT casando por prompt_text (chave
// natural já usada por scripts/seed-phase2-prompts.mjs) — nunca apaga linha
// em uso por phase2_responses, só desativa (is_active = false) o que sair da
// lista. Uso: `node scripts/seed-phase2-part1-pool.mjs`.
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

const SECONDS = 30;

const PART1 = [
  // Papel atual e responsabilidades
  "What is your current role at your workplace?",
  "What are your main responsibilities in your position?",
  "How would you describe your job to someone who has never heard of it?",
  "What kind of decisions do you make on a typical shift?",
  "Who do you report to, and who reports to you, if anyone?",
  "What equipment or systems do you use most often at work?",
  "How is your workplace organized in terms of teams or sectors?",
  "What is the most important skill for someone in your position?",
  "How do you stay focused during a long shift?",
  "What part of your job requires the most concentration?",

  // Carreira e motivação
  "Why did you choose this career?",
  "How long have you been working in aviation?",
  "What did you study or train for before starting this career?",
  "Was aviation always your first choice of career?",
  "Who or what inspired you to work in this field?",
  "What was the hardest part of your training?",
  "How did you feel on your first day at work?",
  "What surprised you most when you started this career?",
  "Have you worked in any other field before this one?",
  "What qualifications did you need to get this job?",
  "How competitive was it to get into this profession?",
  "What advice would you give to someone starting this career today?",
  "Do you plan to stay in this profession for the rest of your career?",
  "What would you change about how people enter this profession?",
  "How has your view of this career changed since you started?",

  // Rotina e dia a dia
  "Describe a typical day at work.",
  "What time do your shifts usually start and end?",
  "How many hours do you usually work in a week?",
  "What is the first thing you do when you arrive at work?",
  "How do you prepare before starting a shift?",
  "What do you usually do during a break?",
  "How do shifts get assigned at your workplace?",
  "What is the busiest time of day at your workplace?",
  "What is the quietest part of your shift usually like?",
  "How do you wind down after a demanding shift?",
  "What routine tasks do you repeat every day?",
  "How do weekends or holidays affect your work schedule?",
  "What do you usually eat or drink to stay alert during a shift?",
  "How far do you travel to get to work?",
  "Do you work the same schedule every week, or does it change?",

  // Comunicação e trabalho em equipe
  "How do you usually communicate with pilots or other controllers?",
  "How important is teamwork in your daily work?",
  "How do you build trust with your colleagues?",
  "Can you describe a time when clear communication made a big difference?",
  "How do you handle a disagreement with a colleague at work?",
  "What makes a good working relationship with your coworkers?",
  "How do new colleagues get integrated into your team?",
  "How do you communicate during a shift handover?",
  "What role does listening play in your job?",
  "How do you make sure important information is not lost during a shift change?",

  // Desafios e resolução de problemas
  "What is the most challenging part of your job?",
  "How do you handle stressful moments at work?",
  "Describe a difficult situation you managed successfully.",
  "What do you do when something unexpected happens during your shift?",
  "How do you stay calm when things get busy?",
  "What kind of problems do you solve on a regular basis?",
  "How do you prioritize tasks when several things happen at once?",
  "What has been your biggest professional challenge so far?",
  "How do you deal with fatigue during long or irregular shifts?",
  "What do you do when you make a mistake at work?",

  // Realizações e orgulho profissional
  "What do you like most about your job?",
  "What are you most proud of in your career?",
  "What has been your most rewarding experience at work?",
  "What achievement in your career means the most to you?",
  "What feedback have you received that made you proud?",
  "What was your favorite moment from your training?",
  "What is something about your job that people usually do not know?",
  "What part of your work gives you the most satisfaction?",
  "How do you know you have done a good job at the end of a shift?",
  "What has been the most interesting day you have had at work?",

  // Ambiente e cultura de trabalho
  "What is the atmosphere like at your workplace?",
  "How does your workplace handle safety culture?",
  "What rules or procedures do you follow most closely?",
  "How does your workplace prepare staff for emergencies?",
  "What is the dress code or uniform like at your job?",
  "How is performance evaluated at your workplace?",
  "What kind of training do you receive regularly?",
  "How often do you have refresher courses or simulations?",
  "How does your workplace support new employees?",
  "What is the physical environment of your workplace like?",

  // Tecnologia e ferramentas
  "How has technology changed your profession over the years?",
  "What piece of equipment could you not work without?",
  "What technology do you expect to see in your field in the future?",
  "What role does automation play in your daily tasks?",

  // Equilíbrio entre vida pessoal e profissional
  "How does your job affect your personal life?",
  "How do you relax on your days off?",
  "How do irregular shifts affect your sleep or routine?",
  "What do you do to recover after a demanding week at work?",
  "How does your family feel about your career choice?",
  "What hobbies help you disconnect from work?",
  "How do you separate work stress from your personal time?",
  "What do you do to stay physically fit for your job?",

  // Futuro e desenvolvimento profissional
  "Where do you see yourself in five years?",
  "What skills would you like to develop further?",
  "What is the next step in your career?",
  "What training or certification would you like to pursue next?",
  "How do you keep your knowledge up to date in this field?",
  "What changes would you like to see in your profession in the future?",
  "What new responsibilities would you like to take on?",
  "How do you plan to keep improving in your role?",

  // Experiências marcantes
  "Describe an experience at work you will never forget.",
  "What was the most unusual situation you have faced on the job?",
  "Tell me about a time you had to make a quick decision.",
  "Describe a moment when you helped a colleague during a difficult shift.",
  "What is a lesson you learned early in your career that still helps you today?",
  "Describe a time when you had to explain something complex to someone quickly.",
  "What was your most memorable interaction with a pilot or another professional?",
  "Describe a situation where teamwork solved a problem quickly.",
  "Tell me about a shift that did not go as planned.",
  "Describe a time you felt especially proud of your team.",

  // Conselhos e reflexão
  "What advice would you give to someone thinking about this career?",
  "What do you wish someone had told you before you started this job?",
  "What qualities do you think make someone successful in this profession?",
  "How would you describe this career to a student choosing a profession?",
  "What is the biggest misconception people have about your job?",
  "What would you tell a colleague who is feeling overwhelmed at work?",
  "How do you mentor or support newer colleagues?",
  "What does professionalism mean to you in this line of work?",
  "How do you keep your motivation up after many years in the profession?",
  "What is one thing you would change about your daily routine at work?",
];

async function upsertByText(client, part, text) {
  const { rows } = await client.query(
    `update public.phase2_prompts
       set expected_duration_seconds = $1, is_active = true
     where part = $2 and operational_profile = 'general' and prompt_text = $3
     returning id`,
    [SECONDS, part, text],
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.phase2_prompts
       (part, operational_profile, prompt_text, expected_duration_seconds, is_active)
     values ($1, 'general', $2, $3, true)
     returning id`,
    [part, text, SECONDS],
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
  const unique = new Set(PART1);
  if (unique.size !== PART1.length) {
    throw new Error("PART1 tem perguntas duplicadas — corrija antes de rodar.");
  }

  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const keptIds = [];
  for (const text of PART1) {
    keptIds.push(await upsertByText(client, "part1", text));
  }
  await deactivateStale(client, "part1", keptIds);

  console.log(`Seed concluído: ${PART1.length} perguntas ativas na Parte 1 (pool 'general').`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
