// Popula phase2_prompts com conteúdo placeholder nas 4 partes (perfil
// 'general', sem restrição de operational_profile), para validar o fluxo
// ponta a ponta da entrevista simulada antes de haver conteúdo real.
// Idempotente: apaga o que já existe com operational_profile='general' antes
// de inserir de novo. Uso: `node scripts/seed-phase2-prompts.mjs`.
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

const PART1 = [
  { text: "What is your current role at your workplace?", seconds: 30 },
  { text: "How long have you been working in aviation?", seconds: 30 },
  { text: "Describe a typical day at work.", seconds: 30 },
  { text: "Why did you choose this career?", seconds: 30 },
  { text: "What do you like most about your job?", seconds: 30 },
  { text: "How do you usually communicate with pilots or other controllers?", seconds: 30 },
];

const PART2 = [
  "A pilot reports a bird strike right after departure. What would you say?",
  "An aircraft requests an unscheduled descent due to a passenger medical emergency. How do you respond?",
  "You notice two aircraft converging at the same altitude. What instruction do you give?",
  "A pilot reports smoke in the cabin. What is your immediate response?",
  "An aircraft's transponder stops responding during your shift. What do you do?",
  "A pilot requests priority landing due to low fuel. How do you handle this?",
  "Severe turbulence is reported by several aircraft in your sector. What do you communicate?",
  "An aircraft reports a hydraulic failure and requests to divert. What is your response?",
  "Two aircraft are instructed to the same runway by mistake. How do you resolve this?",
  "A ground vehicle enters the runway without clearance while an aircraft is on final approach. What do you do?",
  "A pilot reports a bomb threat on board. What is your immediate action?",
  "Multiple aircraft request holding due to a sudden runway closure. How do you manage this?",
].map((text, i) => ({ text, seconds: 45, orderIndex: i + 1 }));

const PART3 = [
  "Describe the busiest hour at your facility.",
  "What changes would improve safety at your workplace?",
  "How does stress affect communication in emergencies?",
  "What role does teamwork play in your daily operations?",
  "How has technology changed your profession over the years?",
  "What makes a good leader in high-pressure situations?",
].map((text) => ({ text, seconds: 45 }));

const PART4 = [
  { text: "Describe what you see in this image.", seconds: 120, imageUrl: "https://picsum.photos/id/1043/1024/768" },
  { text: "Describe what you see in this image.", seconds: 120, imageUrl: "https://picsum.photos/id/1050/1024/768" },
  { text: "Describe what you see in this image.", seconds: 120, imageUrl: "https://picsum.photos/id/1062/1024/768" },
];

async function main() {
  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  await client.query("delete from public.phase2_prompts where operational_profile = 'general'");

  for (const item of PART1) {
    await client.query(
      `insert into public.phase2_prompts (part, operational_profile, prompt_text, expected_duration_seconds, is_active)
       values ('part1', 'general', $1, $2, true)`,
      [item.text, item.seconds],
    );
  }

  for (const item of PART2) {
    await client.query(
      `insert into public.phase2_prompts (part, operational_profile, prompt_text, expected_duration_seconds, order_index, is_active)
       values ('part2', 'general', $1, $2, $3, true)`,
      [item.text, item.seconds, item.orderIndex],
    );
  }

  for (const item of PART3) {
    await client.query(
      `insert into public.phase2_prompts (part, operational_profile, prompt_text, expected_duration_seconds, is_active)
       values ('part3', 'general', $1, $2, true)`,
      [item.text, item.seconds],
    );
  }

  for (const item of PART4) {
    await client.query(
      `insert into public.phase2_prompts (part, operational_profile, prompt_text, image_url, expected_duration_seconds, is_active)
       values ('part4', 'general', $1, $2, $3, true)`,
      [item.text, item.imageUrl, item.seconds],
    );
  }

  console.log(
    `Seed concluído: ${PART1.length} (parte 1), ${PART2.length} (parte 2), ${PART3.length} (parte 3), ${PART4.length} (parte 4).`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
