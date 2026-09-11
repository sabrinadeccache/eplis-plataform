// Guard autoritativo de item + idempotência de resposta — Milestone 2 do
// plano de correção (ver docs/project-status.md). Módulo compartilhado
// pelas duas route handlers de envio de áudio
// (src/app/api/phase2/submit-response/route.ts e .../sdea/submit-response),
// generalizado por nome de tabela (`phase2_responses` | `pilot_responses`)
// igual ao padrão já usado em src/lib/simulations/attempt-guards.ts.
//
// **Identidade de posição (revisão de 2026-09-11):** a posição de uma
// resposta dentro de um item é o `slot` (índice 0-based na lista ordenada de
// estágios de resposta do item — ver response-stages.ts de cada trilha),
// mandado pelo CLIENTE (que já sabe em que passo da sequência está — o
// mesmo `stepIndex` que decide o que renderizar) e VALIDADO aqui contra a
// sequência autoritativa do servidor. Usar só `response_stage` como chave
// não bastava: a Parte 4 do SDEA repete o mesmo estágio ("narrative") duas
// vezes no mesmo item, e tentar inferir "isto é um retry do 1º ou uma
// submissão nova do 2º?" só a partir de quantos slots já estão preenchidos
// é ambíguo — um retry do 1º podia ser confundido com uma submissão nova do
// 2º (achado real da revisão: nesse caso o retry duplicava upload e
// chamada de IA). Com o `slot` vindo do cliente e validado (não podendo
// pular à frente do próximo vazio), a ambiguidade desaparece: um retry
// chega sempre com o MESMO slot da tentativa anterior.
import type { SupabaseServerClient } from "@/lib/simulations/attempt-guards";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ProcessingStatus } from "@/types/database";

export type ItemGuardTable = "phase2_responses" | "pilot_responses";

export class ItemGuardError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ItemGuardError";
    this.status = status;
  }
}

export type ExistingResponseRow = {
  id: string;
  item_slot: number | null;
  response_stage: string;
  processing_status: ProcessingStatus;
  retry_count: number | null;
  transcript: string | null;
  ai_feedback: string | null;
  created_at: string;
};

export type ReservationOutcome =
  // Slot novo (ou retry de um slot com erro) reservado só por esta
  // requisição — segue pro upload/IA e depois atualiza esta linha.
  | { kind: "reserved"; responseId: string; slot: number }
  // Já existe um resultado pronto pra esse exato slot — devolve o cache,
  // sem chamar Whisper/Claude de novo (replay idempotente).
  | { kind: "replay"; response: ExistingResponseRow }
  // Outra requisição já está processando esse exato slot agora (corrida
  // real, ou um retry que chegou depois de perder a corrida por um
  // unique_violation) — rejeitar sem tocar em storage/IA.
  | { kind: "conflict" };

// Teto de reprocessamento da MESMA linha (mesmo slot) depois de um erro —
// sem isso, uma falha real e persistente (ex.: Whisper fora do ar) permitia
// retry ilimitado: como o retry reusa a linha (só muda `processing_status`/
// `started_at`), a contagem de LINHAS por tentativa (rate-limit.ts) nunca
// crescia com isso (achado real da revisão).
export const MAX_RETRIES_PER_SLOT = 5;

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// Checa o tamanho declarado do corpo (header `Content-Length`) ANTES de ler
// qualquer byte — a defesa mais barata possível contra payload gigante,
// porque nem chega a chamar `request.formData()` (achado da revisão:
// `formData()`/`arrayBuffer()` materializavam o corpo inteiro em memória
// ANTES de qualquer checagem de tamanho, e antes até de `authorize()`).
// Quando o header não vem (corpo chunked, sem Content-Length) isto deixa
// passar — a checagem de tamanho REAL do buffer em `validateAudioUpload`
// continua sendo a rede de segurança final nesse caso.
export function assertContentLengthWithinLimit(request: Request, maxBytes: number): void {
  const raw = request.headers.get("content-length");
  if (raw == null) return;
  const length = Number(raw);
  if (Number.isFinite(length) && length > maxBytes) {
    throw new ItemGuardError("Requisição maior que o limite permitido.", 413);
  }
}

// Confirma que o `promptId` mandado pelo cliente é de fato o item corrente
// da tentativa (nunca aceita o valor do formulário como fonte de verdade) —
// cobre "prompt de outra tentativa" e "item anterior/futuro" de uma vez,
// porque a sequência agora é a persistida em `simulation_attempts.item_sequence`
// (congelada na criação da tentativa — ver queries.ts de cada trilha), não
// recalculada a cada chamada.
export function assertCurrentPrompt(expectedPromptId: string | undefined, sentPromptId: string): void {
  if (!expectedPromptId) {
    throw new ItemGuardError("Sequência da tentativa inválida.", 500);
  }
  if (expectedPromptId !== sentPromptId) {
    throw new ItemGuardError("Este item não é o corrente para esta tentativa.", 403);
  }
}

// Valida que o `slot` mandado pelo cliente é estruturalmente possível pra
// este item (índice dentro da lista de estágios esperados e batendo com o
// nome do estágio naquela posição) — checagem barata, antes de qualquer
// leitura no banco.
export function assertValidSlot(slot: number, stage: string, expectedStages: readonly string[]): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= expectedStages.length) {
    throw new ItemGuardError("Posição inválida para este item.", 403);
  }
  if (expectedStages[slot] !== stage) {
    throw new ItemGuardError("Estágio não corresponde à posição informada.", 403);
  }
}

// Linhas antigas (de antes do `item_slot` existir, ou de uma janela de
// deploy em que o código antigo ainda gravava sem ele — ver migration
// 20260911000000_response_item_slot.sql) recebem uma posição sintética,
// pela ordem de criação, preenchendo os slots ainda livres a partir do
// menor índice. Faz o guard funcionar corretamente mesmo numa tentativa que
// tenha respostas de antes E depois do deploy do `item_slot`, sem depender
// de a migration e o deploy acontecerem num instante exato.
function assignSlots(rows: ExistingResponseRow[]): Map<number, ExistingResponseRow> {
  const bySlot = new Map<number, ExistingResponseRow>();
  const explicit = rows.filter((r) => r.item_slot != null);
  const legacy = rows
    .filter((r) => r.item_slot == null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));

  for (const row of explicit) {
    bySlot.set(row.item_slot as number, row);
  }
  let cursor = 0;
  for (const row of legacy) {
    while (bySlot.has(cursor)) cursor += 1;
    bySlot.set(cursor, row);
    cursor += 1;
  }
  return bySlot;
}

// Reserva (ou reaproveita) a linha de resposta certa pra este envio, de
// forma segura contra corrida: duas requisições concorrentes pro mesmo slot
// nunca processam a mesma resposta duas vezes — ou a constraint única
// (simulation_attempt_id, prompt_id, item_slot — migration
// 20260911000000_response_item_slot.sql) rejeita a segunda no INSERT, ou o
// UPDATE condicional (`eq("processing_status","error")`) do retry não afeta
// nenhuma linha na segunda tentativa. Em ambos os casos a perdedora recebe
// `{ kind: "conflict" }` e a rota devolve 409 sem gastar upload nem IA.
export async function reserveResponseSlot(params: {
  supabase: SupabaseServerClient;
  admin: ReturnType<typeof createAdminClient>;
  table: ItemGuardTable;
  attemptId: string;
  promptId: string;
  stage: string;
  slot: number;
  expectedStages: readonly string[];
}): Promise<ReservationOutcome> {
  const { supabase, admin, table, attemptId, promptId, stage, slot, expectedStages } = params;

  assertValidSlot(slot, stage, expectedStages);

  const { data: rows, error: readError } = await supabase
    .from(table)
    .select("id, item_slot, response_stage, processing_status, retry_count, transcript, ai_feedback, created_at")
    .eq("simulation_attempt_id", attemptId)
    .eq("prompt_id", promptId);

  if (readError) {
    throw new ItemGuardError("Não foi possível verificar o estado desta resposta.", 503);
  }

  const bySlot = assignSlots((rows ?? []) as ExistingResponseRow[]);
  const existingAtSlot = bySlot.get(slot);

  if (existingAtSlot) {
    if (existingAtSlot.processing_status === "done") {
      return { kind: "replay", response: existingAtSlot };
    }
    if (existingAtSlot.processing_status === "transcribing" || existingAtSlot.processing_status === "analyzing") {
      return { kind: "conflict" };
    }
    // processing_status === "error": retry, reaproveitando a mesma linha —
    // sujeito ao teto de reprocessamento.
    if ((existingAtSlot.retry_count ?? 0) >= MAX_RETRIES_PER_SLOT) {
      throw new ItemGuardError("Muitas tentativas para este item. Tente novamente mais tarde.", 429);
    }
    const { data: updated } = await admin
      .from(table)
      .update({
        processing_status: "transcribing",
        started_at: new Date().toISOString(),
        retry_count: (existingAtSlot.retry_count ?? 0) + 1,
      })
      .eq("id", existingAtSlot.id)
      .eq("processing_status", "error")
      .select("id")
      .maybeSingle();
    if (!updated) return { kind: "conflict" }; // outra requisição já pegou este retry
    return { kind: "reserved", responseId: updated.id, slot };
  }

  // Slot vazio: só pode ser o próximo da sequência (não deixa pular à
  // frente nem criar um slot "solto").
  let nextEmpty = 0;
  while (bySlot.has(nextEmpty)) nextEmpty += 1;
  if (slot !== nextEmpty) {
    throw new ItemGuardError("Estágio fora de ordem para este item.", 403);
  }

  const { data: inserted, error } = await admin
    .from(table)
    .insert({
      simulation_attempt_id: attemptId,
      prompt_id: promptId,
      response_stage: stage,
      item_slot: slot,
      processing_status: "transcribing",
      started_at: new Date().toISOString(),
    } as never)
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error)) return { kind: "conflict" };
    throw new ItemGuardError("Não foi possível registrar a resposta.", 500);
  }
  if (!inserted) {
    throw new ItemGuardError("Não foi possível registrar a resposta.", 500);
  }

  return { kind: "reserved", responseId: (inserted as { id: string }).id, slot };
}
