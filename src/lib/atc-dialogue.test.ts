// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseAtcDialogue } from "@/lib/atc-dialogue";

describe("parseAtcDialogue", () => {
  it("quebra uma troca Pilot/ATC em dois segmentos", () => {
    const out = parseAtcDialogue(
      "Pilot: Miami Center, American 2493, request return to Miami. ATC: American 2493, roger, turn right heading one five zero.",
    );
    expect(out).toEqual([
      { speaker: "pilot", text: "Miami Center, American 2493, request return to Miami." },
      { speaker: "atc", text: "American 2493, roger, turn right heading one five zero." },
    ]);
  });

  it("lida com várias trocas", () => {
    const out = parseAtcDialogue("Pilot: one. ATC: two. Pilot: three.");
    expect(out.map((s) => s.speaker)).toEqual(["pilot", "atc", "pilot"]);
    expect(out.map((s) => s.text)).toEqual(["one.", "two.", "three."]);
  });

  it("texto sem rótulo vira um único segmento de narração", () => {
    const out = parseAtcDialogue("The aircraft declared an emergency and returned.");
    expect(out).toEqual([
      { speaker: "narration", text: "The aircraft declared an emergency and returned." },
    ]);
  });

  it("é case-insensitive e tolera espaço antes dos dois-pontos", () => {
    const out = parseAtcDialogue("PILOT : mayday. atc: roger mayday.");
    expect(out.map((s) => s.speaker)).toEqual(["pilot", "atc"]);
  });

  it("string vazia retorna lista vazia", () => {
    expect(parseAtcDialogue("")).toEqual([]);
    expect(parseAtcDialogue("   ")).toEqual([]);
  });
});
