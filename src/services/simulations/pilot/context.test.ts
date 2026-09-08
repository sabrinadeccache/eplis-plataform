import { describe, expect, it } from "vitest";
import {
  PART4_DISCUSSION_1,
  PART4_DISCUSSION_2,
  pilotResponseContext,
} from "./context";

const promptFields = {
  prompt_text: "Please describe this picture to me.",
  atc_audio_text: null,
  complication_text: null,
  atc_followup_audio_text: null,
  discussion_question: null,
  discussion_question_2: null,
  agree_disagree_statement: "Drones are a serious threat to aviation.",
};

describe("pilotResponseContext — Parte 4", () => {
  it("não devolve o texto de descrição da imagem nos estágios de discussão", () => {
    expect(pilotResponseContext("discussion_1", promptFields)).toBe(PART4_DISCUSSION_1);
    expect(pilotResponseContext("discussion_2", promptFields)).toBe(PART4_DISCUSSION_2);
    expect(pilotResponseContext("discussion_1", promptFields)).not.toBe(promptFields.prompt_text);
  });

  it("descrição da imagem usa o prompt do banco; concordar/discordar usa a afirmação", () => {
    expect(pilotResponseContext("picture_description", promptFields)).toBe(promptFields.prompt_text);
    expect(pilotResponseContext("agree_disagree", promptFields)).toBe(
      promptFields.agree_disagree_statement,
    );
  });

  it("narrativa livre não pede descrição literal da imagem", () => {
    expect(pilotResponseContext("narrative", promptFields).toLowerCase()).toContain("narrative");
  });
});
