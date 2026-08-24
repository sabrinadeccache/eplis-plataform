import { describe, expect, it, vi } from "vitest";
import type { Part } from "@/types/database";

type FakeRow = {
  id: string;
  part: Part;
  prompt_text: string;
  expected_duration_seconds: number;
  order_index: number | null;
  aircraft_type: string;
  is_active: boolean;
};

function makeRows(part: Part, aircraftType: string, count: number): FakeRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${part}-${aircraftType}-${i}`,
    part,
    prompt_text: `${part} prompt ${i}`,
    expected_duration_seconds: 60,
    order_index: i + 1,
    aircraft_type: aircraftType,
    is_active: true,
  }));
}

const ALL_ROWS: FakeRow[] = [
  ...makeRows("part1", "general", 8),
  ...makeRows("part2", "fixed_wing", 8),
  ...makeRows("part3", "fixed_wing", 6),
  ...makeRows("part4", "fixed_wing", 5),
];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from() {
      return {
        select() {
          return this;
        },
        eq(column: string, value: unknown) {
          this._filters = { ...this._filters, [column]: value };
          return this;
        },
        in(column: string, values: unknown[]) {
          this._filters = { ...this._filters, [column]: values };
          return Promise.resolve({
            data: ALL_ROWS.filter((row) => {
              const partMatch = this._filters.part ? row.part === this._filters.part : true;
              const activeMatch =
                this._filters.is_active === undefined || row.is_active === this._filters.is_active;
              const typeMatch = (values as string[]).includes(row.aircraft_type);
              return partMatch && activeMatch && typeMatch;
            }),
          });
        },
        _filters: {} as Record<string, unknown>,
      };
    },
  })),
}));

const { getSequenceForAttempt, sequenceHasEnoughItems } = await import("./queries");

describe("getSequenceForAttempt (piloto)", () => {
  it("é determinístico para o mesmo attemptId", async () => {
    const a = await getSequenceForAttempt("attempt-1", "fixed_wing");
    const b = await getSequenceForAttempt("attempt-1", "fixed_wing");
    expect(a).toEqual(b);
  });

  it("produz sequências diferentes para attemptIds diferentes", async () => {
    const a = await getSequenceForAttempt("attempt-1", "fixed_wing");
    const b = await getSequenceForAttempt("attempt-2", "fixed_wing");
    expect(a).not.toEqual(b);
  });

  it("respeita o tamanho de cada parte e não repete itens", async () => {
    const sequence = await getSequenceForAttempt("attempt-3", "fixed_wing");
    expect(sequence.part1).toHaveLength(3);
    expect(sequence.part2).toHaveLength(5);
    expect(sequence.part3).toHaveLength(3);
    expect(sequence.part4).toHaveLength(1);
    expect(sequenceHasEnoughItems(sequence)).toBe(true);

    const part2Ids = new Set(sequence.part2.map((p) => p.id));
    expect(part2Ids.size).toBe(5);
  });

  it("perfil sem pool cadastrado (rotary_wing) detecta conteúdo insuficiente", async () => {
    const sequence = await getSequenceForAttempt("attempt-4", "rotary_wing");
    expect(sequenceHasEnoughItems(sequence)).toBe(false);
  });
});
