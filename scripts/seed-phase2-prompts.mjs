// Popula phase2_prompts com conteúdo placeholder nas 4 partes (perfil
// 'general', sem restrição de operational_profile), para validar o fluxo
// ponta a ponta da entrevista simulada antes de haver conteúdo real.
// Idempotente via UPSERT (update se já existe, insert se não) — NÃO apaga
// linhas em uso: assim que houve a primeira `simulation_attempt` real, um
// `delete` na tabela toda passou a falhar por causa da FK de
// `phase2_responses.prompt_id` (violação observada em produção). Item que
// saiu da lista atual é apenas desativado (`is_active = false`), nunca
// apagado, pra não quebrar `phase2_responses` históricas que ainda apontam
// pra ele. Uso: `node scripts/seed-phase2-prompts.mjs`.
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

// Cada situação termina obrigatoriamente com "What's the situation?" — é o
// gatilho fixo que habilita o botão de resposta no runner (Parte 2 agora tem
// só 2 estágios: descrição da situação + pergunta fixa em um único turno da
// IA, depois a sugestão do candidato).
const PART2 = [
  "A pilot reports a bird strike right after departure. What's the situation?",
  "An aircraft requests an unscheduled descent due to a passenger medical emergency. What's the situation?",
  "You notice two aircraft converging at the same altitude. What's the situation?",
  "A pilot reports smoke in the cabin. What's the situation?",
  "An aircraft's transponder stops responding during your shift. What's the situation?",
  "A pilot requests priority landing due to low fuel. What's the situation?",
  "Severe turbulence is reported by several aircraft in your sector. What's the situation?",
  "An aircraft reports a hydraulic failure and requests to divert. What's the situation?",
  "Two aircraft are instructed to the same runway by mistake. What's the situation?",
  "A ground vehicle enters the runway without clearance while an aircraft is on final approach. What's the situation?",
  "A pilot reports a bomb threat on board. What's the situation?",
  "Multiple aircraft request holding due to a sudden runway closure. What's the situation?",
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

// Parte 2 tem uma chave natural estável (`order_index`, 1..12 — a posição da
// situação na sequência do exame). As outras partes não usam `order_index`
// pra nada na seleção (ver `queries.ts`), então usamos o próprio texto do
// prompt como chave natural: é único dentro de cada parte e só muda quando o
// conteúdo placeholder for substituído por conteúdo real (nesse caso, o item
// antigo é desativado e um novo é inserido, sem perder o histórico).
async function upsertByOrderIndex(client, part, item) {
  const { rows } = await client.query(
    `update public.phase2_prompts
       set prompt_text = $1, expected_duration_seconds = $2, is_active = true
     where part = $3 and operational_profile = 'general' and order_index = $4
     returning id`,
    [item.text, item.seconds, part, item.orderIndex],
  );
  if (rows.length > 0) return;
  await client.query(
    `insert into public.phase2_prompts
       (part, operational_profile, prompt_text, expected_duration_seconds, order_index, is_active)
     values ($1, 'general', $2, $3, $4, true)`,
    [part, item.text, item.seconds, item.orderIndex],
  );
}

async function upsertByText(client, part, item) {
  const { rows } = await client.query(
    `update public.phase2_prompts
       set expected_duration_seconds = $1, image_url = $2, is_active = true
     where part = $3 and operational_profile = 'general' and prompt_text = $4
     returning id`,
    [item.seconds, item.imageUrl ?? null, part, item.text],
  );
  if (rows.length > 0) return;
  await client.query(
    `insert into public.phase2_prompts
       (part, operational_profile, prompt_text, image_url, expected_duration_seconds, is_active)
     values ($1, 'general', $2, $3, $4, true)`,
    [part, item.text, item.imageUrl ?? null, item.seconds],
  );
}

// Parte 4 repete o mesmo `prompt_text` ("Describe what you see in this
// image.") pras 3 imagens — ali a chave natural é a própria imagem
// (`image_url`), não o texto.
async function upsertByImageUrl(client, part, item) {
  const { rows } = await client.query(
    `update public.phase2_prompts
       set prompt_text = $1, expected_duration_seconds = $2, is_active = true
     where part = $3 and operational_profile = 'general' and image_url = $4
     returning id`,
    [item.text, item.seconds, part, item.imageUrl],
  );
  if (rows.length > 0) return;
  await client.query(
    `insert into public.phase2_prompts
       (part, operational_profile, prompt_text, image_url, expected_duration_seconds, is_active)
     values ($1, 'general', $2, $3, $4, true)`,
    [part, item.text, item.imageUrl, item.seconds],
  );
}

// Desativa (nunca apaga) linhas de uma parte que não estão mais na lista
// atual — mantém `phase2_responses` históricas íntegras.
async function deactivateStale(client, part, keptIds) {
  await client.query(
    `update public.phase2_prompts
       set is_active = false
     where part = $1 and operational_profile = 'general' and not (id = any($2::uuid[]))`,
    [part, keptIds],
  );
}

async function currentIds(client, part) {
  const { rows } = await client.query(
    `select id, prompt_text, image_url, order_index from public.phase2_prompts
     where part = $1 and operational_profile = 'general'`,
    [part],
  );
  return rows;
}

async function main() {
  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  for (const item of PART1) {
    await upsertByText(client, "part1", item);
  }
  for (const item of PART2) {
    await upsertByOrderIndex(client, "part2", item);
  }
  for (const item of PART3) {
    await upsertByText(client, "part3", item);
  }
  for (const item of PART4) {
    await upsertByImageUrl(client, "part4", item);
  }

  const part2Rows = await currentIds(client, "part2");
  const keptPart2Ids = PART2.map(
    (item) => part2Rows.find((r) => r.order_index === item.orderIndex)?.id,
  ).filter(Boolean);
  await deactivateStale(client, "part2", keptPart2Ids);

  for (const [part, items] of [
    ["part1", PART1],
    ["part3", PART3],
  ]) {
    const rows = await currentIds(client, part);
    const keptIds = items
      .map((item) => rows.find((r) => r.prompt_text === item.text)?.id)
      .filter(Boolean);
    await deactivateStale(client, part, keptIds);
  }

  const part4Rows = await currentIds(client, "part4");
  const keptPart4Ids = PART4.map(
    (item) => part4Rows.find((r) => r.image_url === item.imageUrl)?.id,
  ).filter(Boolean);
  await deactivateStale(client, "part4", keptPart4Ids);

  console.log(
    `Seed concluído: ${PART1.length} (parte 1), ${PART2.length} (parte 2), ${PART3.length} (parte 3), ${PART4.length} (parte 4).`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
