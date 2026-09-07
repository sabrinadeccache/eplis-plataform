// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  readProfileExtraFields,
  profileExtraFieldsToMetadata,
} from "@/lib/profile-fields";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("readProfileExtraFields", () => {
  it("mantém valores válidos e normaliza a UF", () => {
    const out = readProfileExtraFields(
      fd({
        work_location: "  TWR-SBGL  ",
        home_state: "sp",
        home_city: "São José dos Campos",
        phone: "(12) 99999-0000",
        current_icao_level: "4",
        icao_level_valid_until: "2027-03-01",
        exam_target_date: "2026-11-20",
        training_goal: "Subir de nível",
      }),
    );
    expect(out).toEqual({
      work_location: "TWR-SBGL",
      home_state: "SP",
      home_city: "São José dos Campos",
      phone: "(12) 99999-0000",
      current_icao_level: 4,
      icao_level_valid_until: "2027-03-01",
      exam_target_date: "2026-11-20",
      training_goal: "Subir de nível",
    });
  });

  it("rejeita UF, nível, data e objetivo inválidos", () => {
    const out = readProfileExtraFields(
      fd({
        home_state: "ZZ",
        current_icao_level: "9",
        icao_level_valid_until: "01/03/2027",
        exam_target_date: "",
        training_goal: "qualquer coisa",
      }),
    );
    expect(out.home_state).toBeNull();
    expect(out.current_icao_level).toBeNull();
    expect(out.icao_level_valid_until).toBeNull();
    expect(out.exam_target_date).toBeNull();
    expect(out.training_goal).toBeNull();
  });

  it("campos ausentes viram null", () => {
    const out = readProfileExtraFields(fd({}));
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });
});

describe("profileExtraFieldsToMetadata", () => {
  it("converte null para string vazia e número para texto", () => {
    const meta = profileExtraFieldsToMetadata({
      work_location: null,
      home_state: "RJ",
      home_city: null,
      phone: null,
      current_icao_level: 5,
      icao_level_valid_until: null,
      exam_target_date: "2026-12-01",
      training_goal: null,
    });
    expect(meta.work_location).toBe("");
    expect(meta.home_state).toBe("RJ");
    expect(meta.current_icao_level).toBe("5");
    expect(meta.exam_target_date).toBe("2026-12-01");
    expect(Object.values(meta).every((v) => typeof v === "string")).toBe(true);
  });
});
