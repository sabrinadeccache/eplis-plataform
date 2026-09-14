import { describe, expect, it, vi } from "vitest";
import { getCompletedOfficialAttempts } from "./performance";

describe("getCompletedOfficialAttempts", () => {
  it("aplica a mesma barreira official + completed em todas as fases", async () => {
    const calls: unknown[][] = [];
    const result = [{ id: "a1", score: null, started_at: "2026-01-01", finished_at: "2026-01-02" }];
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((...args: unknown[]) => { calls.push(args); return chain; }),
      order: vi.fn(async () => ({ data: result, error: null })),
    };
    const supabase = { from: vi.fn(() => chain) } as never;

    await expect(getCompletedOfficialAttempts(supabase, "u1", "pilot_interview")).resolves.toEqual(result);
    expect(calls).toEqual([
      ["user_id", "u1"],
      ["phase", "pilot_interview"],
      ["mode", "official"],
      ["status", "completed"],
    ]);
  });
});
