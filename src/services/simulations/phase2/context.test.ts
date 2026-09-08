import { describe, expect, it } from "vitest";
import { phase2ResponseQuestion, STORY_TELLING_QUESTION } from "./context";

describe("phase2ResponseQuestion", () => {
  it("story_telling não mostra o texto de descrição da imagem", () => {
    expect(phase2ResponseQuestion("story_telling", "Describe what you see in this image.")).toBe(
      STORY_TELLING_QUESTION,
    );
  });

  it("suggestion tem pergunta própria; os demais usam o prompt do banco", () => {
    expect(phase2ResponseQuestion("suggestion", "ignored")).toBe("Make a suggestion.");
    expect(phase2ResponseQuestion("image_description", "Describe what you see in this image.")).toBe(
      "Describe what you see in this image.",
    );
    expect(phase2ResponseQuestion("main", "What do you do in your job?")).toBe(
      "What do you do in your job?",
    );
  });
});
