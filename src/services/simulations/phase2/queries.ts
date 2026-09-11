import { createClient } from "@/lib/supabase/server";
import { mulberry32, hashStringToSeed, seededShuffle } from "@/lib/prng";
import type { OperationalProfile, Part } from "@/types/database";

export type Phase2Prompt = {
  id: string;
  part: Part;
  promptText: string;
  imageUrl: string | null;
  expectedDurationSeconds: number;
};

export type Phase2Sequence = {
  part1: Phase2Prompt[];
  part2: Phase2Prompt[];
  part3: Phase2Prompt[];
  part4: Phase2Prompt[];
};

const PART_SIZES: Record<Part, number> = { part1: 4, part2: 10, part3: 4, part4: 1 };

// Parte 3: as 2 primeiras perguntas da entrevista precisam ser concretas
// (situações do próprio trabalho do candidato) e as 2 últimas, abstratas
// (opiniões/reflexões mais amplas) — spec oficial, ver docs/database-schema.md.
// `order_index` é reaproveitado como marcador de nível (1 = concreta,
// 2 = abstrata), não como posição literal — ver scripts/seed-phase2-part3-pool.mjs.
const PART3_CONCRETE_TIER = 1;
const PART3_ABSTRACT_TIER = 2;
const PART3_CONCRETE_COUNT = 2;
const PART3_ABSTRACT_COUNT = 2;

type PromptRow = {
  id: string;
  part: Part;
  prompt_text: string;
  image_url: string | null;
  expected_duration_seconds: number;
  order_index: number | null;
};

function toPrompt(row: PromptRow): Phase2Prompt {
  return {
    id: row.id,
    part: row.part,
    promptText: row.prompt_text,
    imageUrl: row.image_url,
    expectedDurationSeconds: row.expected_duration_seconds,
  };
}

// Sequência (part -> ids de phase2_prompts, na ordem exibida) pra persistir
// em `simulation_attempts.item_sequence` no momento da criação da tentativa
// — ver `startAttempt` em actions.ts. Congela o sorteio feito AGORA, com o
// pool ativo e o perfil de AGORA; não é recalculado depois.
export type Phase2ItemSequence = Record<Part, string[]>;

export function sequenceToItemIds(sequence: Phase2Sequence): Phase2ItemSequence {
  return {
    part1: sequence.part1.map((p) => p.id),
    part2: sequence.part2.map((p) => p.id),
    part3: sequence.part3.map((p) => p.id),
    part4: sequence.part4.map((p) => p.id),
  };
}

// Recarrega os prompts completos de uma sequência JÁ persistida
// (`item_sequence`), na MESMA ordem, por id — sem reaplicar o filtro
// `is_active`/perfil (o item já foi validamente sorteado quando a tentativa
// começou; se o conteúdo for desativado depois, a tentativa em andamento
// precisa continuar enxergando o mesmo item, não sumir ou trocar). Prompts
// que não existem mais (linha apagada de verdade, não só desativada) são
// simplesmente omitidos — não deveria acontecer na prática (o pool só
// desativa, nunca deleta, ver docs/database-schema.md), mas não trava a
// tentativa se acontecer.
async function loadPersistedSequence(persisted: Phase2ItemSequence): Promise<Phase2Sequence> {
  const supabase = await createClient();
  const allIds = [...persisted.part1, ...persisted.part2, ...persisted.part3, ...persisted.part4];
  const { data } = await supabase
    .from("phase2_prompts")
    .select("id, part, prompt_text, image_url, expected_duration_seconds, order_index")
    .in("id", allIds);
  const byId = new Map(((data as PromptRow[] | null) ?? []).map((row) => [row.id, toPrompt(row)]));

  function resolve(ids: string[]): Phase2Prompt[] {
    return ids.map((id) => byId.get(id)).filter((p): p is Phase2Prompt => p != null);
  }

  return {
    part1: resolve(persisted.part1),
    part2: resolve(persisted.part2),
    part3: resolve(persisted.part3),
    part4: resolve(persisted.part4),
  };
}

// Sorteia uma sequência NOVA (seed determinística = attemptId) a partir do
// pool ATIVO e do perfil informado AGORA. Só deve ser chamada em dois casos:
// ao criar a tentativa (pra persistir o resultado em `item_sequence`) ou
// como fallback pra uma tentativa antiga, de antes dessa coluna existir (ver
// `getSequenceForAttempt` abaixo) — nunca pra recalcular a sequência de uma
// tentativa que já tem `item_sequence` persistido.
export async function drawSequenceForAttempt(
  attemptId: string,
  profile: OperationalProfile | null,
): Promise<Phase2Sequence> {
  const supabase = await createClient();
  const profileFilter: OperationalProfile[] = profile ? [profile, "general"] : ["general"];
  const rng = mulberry32(hashStringToSeed(attemptId));

  async function poolFor(part: Part): Promise<PromptRow[]> {
    const { data } = await supabase
      .from("phase2_prompts")
      .select("id, part, prompt_text, image_url, expected_duration_seconds, order_index")
      .eq("part", part)
      .eq("is_active", true)
      .in("operational_profile", profileFilter);
    return (data as PromptRow[] | null) ?? [];
  }

  // Consumido sequencialmente (não Promise.all) pra manter a ordem de consumo
  // do rng fácil de raciocinar: part1 -> part2 -> part3 -> part4.
  const pool1 = await poolFor("part1");
  const part1 = seededShuffle(pool1, rng).slice(0, PART_SIZES.part1).map(toPrompt);

  const pool2 = await poolFor("part2");
  const part2 = seededShuffle(pool2, rng)
    .slice(0, PART_SIZES.part2)
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .map(toPrompt);

  const pool3 = await poolFor("part3");
  const concretePool3 = pool3.filter((row) => row.order_index === PART3_CONCRETE_TIER);
  const abstractPool3 = pool3.filter((row) => row.order_index === PART3_ABSTRACT_TIER);
  const part3 = [
    ...seededShuffle(concretePool3, rng).slice(0, PART3_CONCRETE_COUNT),
    ...seededShuffle(abstractPool3, rng).slice(0, PART3_ABSTRACT_COUNT),
  ].map(toPrompt);

  const pool4 = await poolFor("part4");
  const part4 = seededShuffle(pool4, rng).slice(0, PART_SIZES.part4).map(toPrompt);

  return { part1, part2, part3, part4 };
}

// Ponto de entrada usado pelas telas da entrevista e pelo guard de item: se a
// tentativa já tem `item_sequence` persistido, recarrega exatamente aqueles
// prompts (estável, imune a mudança de pool/perfil depois do início). Sem
// isso (`persistedSequence` `null`/`undefined` — só tentativas criadas antes
// da migration `20260911010000`), cai no sorteio ao vivo antigo, só pra não
// quebrar uma tentativa que já estava em andamento no deploy.
export async function getSequenceForAttempt(
  attemptId: string,
  profile: OperationalProfile | null,
  persistedSequence?: Phase2ItemSequence | null,
): Promise<Phase2Sequence> {
  if (persistedSequence) {
    return loadPersistedSequence(persistedSequence);
  }
  return drawSequenceForAttempt(attemptId, profile);
}

export function sequenceHasEnoughItems(sequence: Phase2Sequence): boolean {
  return (
    sequence.part1.length === PART_SIZES.part1 &&
    sequence.part2.length === PART_SIZES.part2 &&
    sequence.part3.length === PART_SIZES.part3 &&
    sequence.part4.length === PART_SIZES.part4
  );
}
