import { createClient } from "@/lib/supabase/server";
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

// PRNG determinístico simples (mulberry32) — mesmo attemptId sempre produz a
// mesma sequência sorteada, sem precisar persistir os prompt_ids em nenhum
// lugar novo do schema.
function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

function seededShuffle<T>(items: T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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
  const part3 = seededShuffle(pool3, rng).slice(0, PART_SIZES.part3).map(toPrompt);

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
