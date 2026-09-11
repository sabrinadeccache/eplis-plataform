// Guard autoritativo de item + idempotência de resposta — Milestone 2 do
// plano de correção (ver docs/project-status.md → "Próximo passo"). Módulo
// compartilhado pelas duas route handlers de envio de áudio
// (src/app/api/phase2/submit-response/route.ts e .../sdea/submit-response),
// generalizado por nome de tabela (`phase2_responses` | `pilot_responses`)
// igual ao padrão já usado em src/lib/simulations/attempt-guards.ts.
//
// A posição "correta" de uma resposta dentro de um item nunca vem do
// cliente — o único dado confiável é `attempt.current_part` /
// `current_item_index` (persistidos pelo servidor, ver
// docs/state-machine.md) mais a sequência determinística de prompts daquela
// tentativa (`getSequenceForAttempt`, seed = attemptId) e a lista ordenada
// de estágios de resposta do item (`response-stages.ts` de cada trilha).
// `item_slot` é a posição (0-based) nessa lista — não o nome do estágio,
// porque a Parte 4 do SDEA repete "narrative" duas vezes no mesmo item.
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
  transcript: string | null;
  ai_feedback: string | null;
};

export type ReservationOutcome =
  // Slot novo (ou retry de um slot com erro) reservado só por esta
  // requisição — segue pro upload/IA e depois atualiza esta linha.
  | { kind: "reserved"; responseId: string; slot: number }
  // Já existe um resultado pronto pra esse exato estágio/posição — devolve
  // o cache, sem chamar Whisper/Claude de novo (replay idempotente).
  | { kind: "replay"; response: ExistingResponseRow }
  // Outra requisição já está processando esse exato slot agora (corrida
  // real, ou um retry que chegou depois de perder a corrida por um
  // unique_violation) — rejeitar sem tocar em storage/IA.
  | { kind: "conflict" };

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// Confirma que o `promptId` mandado pelo cliente é de fato o item corrente
// da tentativa (nunca aceita o valor do formulário como fonte de verdade) —
// cobre "prompt de outra tentativa" e "item anterior/futuro" de uma vez,
// porque a sequência é determinística por `attemptId` e a posição corrente
// vem só do banco.
export function assertCurrentPrompt(expectedPromptId: string | undefined, sentPromptId: string): void {
  if (!expectedPromptId) {
    throw new ItemGuardError("Sequência da tentativa inválida.", 500);
  }
  if (expectedPromptId !== sentPromptId) {
    throw new ItemGuardError("Este item não é o corrente para esta tentativa.", 403);
  }
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
  expectedStages: readonly string[];
}): Promise<ReservationOutcome> {
  const { supabase, admin, table, attemptId, promptId, stage, expectedStages } = params;

  if (expectedStages.length === 0) {
    throw new ItemGuardError("Sequência da tentativa inválida.", 500);
  }

  const { data: rows } = await supabase
    .from(table)
    .select("id, item_slot, response_stage, processing_status, transcript, ai_feedback")
    .eq("simulation_attempt_id", attemptId)
    .eq("prompt_id", promptId);

  const existing = (rows ?? []) as ExistingResponseRow[];
  const bySlot = new Map<number, ExistingResponseRow>();
  for (const row of existing) {
    if (row.item_slot != null) bySlot.set(row.item_slot, row);
  }

  // 1. Retry de um estágio que já tinha sido tentado e falhou — reaproveita
  // a MESMA linha (menor slot cujo estágio bate e está com erro), em vez de
  // criar uma nova. CAS via `.eq("processing_status", "error")`: se outra
  // requisição já pegou esse retry entre a leitura acima e agora, `updated`
  // vem vazio.
  const retryCandidate = [...bySlot.entries()]
    .filter(([, row]) => row.response_stage === stage && row.processing_status === "error")
    .sort((a, b) => a[0] - b[0])[0];

  if (retryCandidate) {
    const [slot, row] = retryCandidate;
    const { data: updated } = await admin
      .from(table)
      .update({ processing_status: "transcribing", started_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("processing_status", "error")
      .select("id")
      .maybeSingle();
    if (!updated) return { kind: "conflict" };
    return { kind: "reserved", responseId: updated.id, slot };
  }

  // 2. Já existe uma linha desse estágio em voo (transcrevendo/analisando)
  // — é uma segunda chamada concorrente pro mesmo estágio, não um retry
  // pós-erro. Rejeita sem duplicar a chamada de IA.
  const inflight = [...bySlot.values()].find(
    (row) =>
      row.response_stage === stage &&
      (row.processing_status === "transcribing" || row.processing_status === "analyzing"),
  );
  if (inflight) return { kind: "conflict" };

  // 3. Primeiro slot vazio da sequência esperada.
  let nextEmpty = -1;
  for (let i = 0; i < expectedStages.length; i += 1) {
    if (!bySlot.has(i)) {
      nextEmpty = i;
      break;
    }
  }

  if (nextEmpty === -1) {
    // Todo slot já tem linha — só pode ser replay de um estágio já
    // concluído (ex.: o cliente reenviou depois de perder a resposta de
    // sucesso por causa de queda de rede). Sem isso, um segundo clique
    // acidental na Fase 4 (as duas respostas "narrative") tentaria criar
    // uma 3ª linha em vez de devolver a última já feita.
    const done = [...bySlot.values()]
      .filter((row) => row.response_stage === stage && row.processing_status === "done")
      .sort((a, b) => (a.item_slot ?? 0) - (b.item_slot ?? 0))
      .pop();
    if (done) return { kind: "replay", response: done };
    throw new ItemGuardError("Este item já foi totalmente respondido.", 409);
  }

  if (expectedStages[nextEmpty] !== stage) {
    throw new ItemGuardError("Estágio fora de ordem para este item.", 403);
  }

  const { data: inserted, error } = await admin
    .from(table)
    .insert({
      simulation_attempt_id: attemptId,
      prompt_id: promptId,
      response_stage: stage,
      item_slot: nextEmpty,
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

  return { kind: "reserved", responseId: (inserted as { id: string }).id, slot: nextEmpty };
}
