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

export async function getSequenceForAttempt(
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

export function sequenceHasEnoughItems(sequence: Phase2Sequence): boolean {
  return (
    sequence.part1.length === PART_SIZES.part1 &&
    sequence.part2.length === PART_SIZES.part2 &&
    sequence.part3.length === PART_SIZES.part3 &&
    sequence.part4.length === PART_SIZES.part4
  );
}
