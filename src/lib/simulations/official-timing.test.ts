import { describe, expect, it } from "vitest";
import { validateOfficialTiming } from "./official-timing";

const base = {
  id: "w1",
  recording_started_at: "2026-09-14T12:00:00.000Z",
  recording_finished_at: "2026-09-14T12:00:30.000Z",
  repetition_count: 1,
  expected_duration_seconds: 30,
};

describe("validateOfficialTiming", () => {
  it("aceita duração decodificada coerente dentro da tolerância", () => {
    expect(() => validateOfficialTiming(base, 29.4)).not.toThrow();
  });

  it("rejeita relógio ausente, duração excedida e áudio incompatível", () => {
    expect(() => validateOfficialTiming({ ...base, recording_finished_at: null }, 29)).toThrow();
    expect(() => validateOfficialTiming({ ...base, recording_finished_at: "2026-09-14T12:00:34.000Z" }, 34)).toThrow();
    expect(() => validateOfficialTiming(base, 10)).toThrow();
  });
});
