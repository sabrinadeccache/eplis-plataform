import { createClient } from "@/lib/supabase/server";
import { mulberry32, hashStringToSeed, seededShuffle } from "@/lib/prng";
import type { OperationalProfile, Part } from "@/types/database";

export type PilotAircraftType = Extract<OperationalProfile, "fixed_wing" | "rotary_wing">;

export type PilotPrompt = {
  id: string;
  part: Part;
  promptText: string;
  atcAudioText: string | null;
  atcAudioUrl: string | null;
  expectedReadback: string | null;
  complicationText: string | null;
  complicationImageUrl: string | null;
  expectedReaction: string | null;
  atcFollowupAudioText: string | null;
  atcFollowupAudioUrl: string | null;
  expectedConfirmation: string | null;
  dialogueAudioUrl: string | null;
  discussionQuestion: string | null;
  discussionQuestion2: string | null;
  imageUrl: string | null;
  agreeDisagreeStatement: string | null;
  expectedDurationSeconds: number;
};

export type PilotSequence = {
  part1: PilotPrompt[];
  part2: PilotPrompt[];
  part3: PilotPrompt[];
  part4: PilotPrompt[];
};

const PART_SIZES: Record<Part, number> = { part1: 3, part2: 5, part3: 3, part4: 1 };

type PromptRow = {
  id: string;
  part: Part;
  prompt_text: string;
  atc_audio_text: string | null;
  atc_audio_url: string | null;
  expected_readback: string | null;
  complication_text: string | null;
  complication_image_url: string | null;
  expected_reaction: string | null;
  atc_followup_audio_text: string | null;
  atc_followup_audio_url: string | null;
  expected_confirmation: string | null;
  dialogue_audio_url: string | null;
  discussion_question: string | null;
  discussion_question_2: string | null;
  image_url: string | null;
  agree_disagree_statement: string | null;
  expected_duration_seconds: number;
  order_index: number | null;
};

function toPrompt(row: PromptRow): PilotPrompt {
  return {
    id: row.id,
    part: row.part,
    promptText: row.prompt_text,
    atcAudioText: row.atc_audio_text,
    atcAudioUrl: row.atc_audio_url,
    expectedReadback: row.expected_readback,
    complicationText: row.complication_text,
    complicationImageUrl: row.complication_image_url,
    expectedReaction: row.expected_reaction,
    atcFollowupAudioText: row.atc_followup_audio_text,
    atcFollowupAudioUrl: row.atc_followup_audio_url,
    expectedConfirmation: row.expected_confirmation,
    dialogueAudioUrl: row.dialogue_audio_url,
    discussionQuestion: row.discussion_question,
    discussionQuestion2: row.discussion_question_2,
    imageUrl: row.image_url,
    agreeDisagreeStatement: row.agree_disagree_statement,
    expectedDurationSeconds: row.expected_duration_seconds,
  };
}

const PROMPT_COLUMNS =
  "id, part, prompt_text, atc_audio_text, atc_audio_url, expected_readback, complication_text, " +
  "complication_image_url, expected_reaction, atc_followup_audio_text, atc_followup_audio_url, " +
  "expected_confirmation, dialogue_audio_url, discussion_question, discussion_question_2, image_url, " +
  "agree_disagree_statement, expected_duration_seconds, order_index";

export async function getSequenceForAttempt(
  attemptId: string,
  aircraftType: PilotAircraftType,
): Promise<PilotSequence> {
  const supabase = await createClient();
  // Parte 1 é compartilhada entre os dois perfis (perguntas de carreira
  // agnósticas ao tipo de aeronave, marcadas "general"); Partes 2-4 puxam só
  // do tipo específico — o conteúdo real difere por aeronave (ex.
  // autorrotação é exclusivo de helicóptero).
  const profileFilter: OperationalProfile[] = [aircraftType, "general"];
  const rng = mulberry32(hashStringToSeed(attemptId));

  async function poolFor(part: Part): Promise<PromptRow[]> {
    const { data } = await supabase
      .from("pilot_prompts")
      .select(PROMPT_COLUMNS)
      .eq("part", part)
      .eq("is_active", true)
      .in("aircraft_type", profileFilter);
    return (data as PromptRow[] | null) ?? [];
  }

  // Consumido sequencialmente (não Promise.all) pra manter a ordem de consumo
  // do rng fácil de raciocinar: part1 -> part2 -> part3 -> part4.
  const pool1 = await poolFor("part1");
  const part1 = seededShuffle(pool1, rng).slice(0, PART_SIZES.part1).map(toPrompt);

  const pool2 = await poolFor("part2");
  const part2 = seededShuffle(pool2, rng).slice(0, PART_SIZES.part2).map(toPrompt);

  const pool3 = await poolFor("part3");
  const part3 = seededShuffle(pool3, rng).slice(0, PART_SIZES.part3).map(toPrompt);

  const pool4 = await poolFor("part4");
  const part4 = seededShuffle(pool4, rng).slice(0, PART_SIZES.part4).map(toPrompt);

  return { part1, part2, part3, part4 };
}

export function sequenceHasEnoughItems(sequence: PilotSequence): boolean {
  return (
    sequence.part1.length === PART_SIZES.part1 &&
    sequence.part2.length === PART_SIZES.part2 &&
    sequence.part3.length === PART_SIZES.part3 &&
    sequence.part4.length === PART_SIZES.part4
  );
}
