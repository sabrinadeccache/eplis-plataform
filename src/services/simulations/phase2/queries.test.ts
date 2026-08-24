import { describe, expect, it, vi } from "vitest";
import type { Part } from "@/types/database";

type FakeRow = {
  id: string;
  part: Part;
  prompt_text: string;
  image_url: string | null;
  expected_duration_seconds: number;
  order_index: number | null;
  operational_profile: string;
  is_active: boolean;
};

function makeRows(part: Part, count: number, orderIndex: (i: number) => number | null): FakeRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${part}-${i}`,
    part,
    prompt_text: `${part} prompt ${i}`,
    image_url: null,
    expected_duration_seconds: 30,
    order_index: orderIndex(i),
    operational_profile: "general",
    is_active: true,
  }));
}

const ALL_ROWS: FakeRow[] = [
  ...makeRows("part1", 8, () => null),
  ...makeRows("part2", 15, (i) => i + 1),
  // Parte 3: 6 concretas (order_index 1) + 6 abstratas (order_index 2), pool
  // maior que os 2+2 sorteados para o teste conseguir detectar embaralhamento.
  ...makeRows("part3", 6, () => 1),
  ...makeRows("part3", 6, () => 2).map((row, i) => ({ ...row, id: `part3-abstract-${i}` })),
  ...makeRows("part4", 5, () => null),
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
              const profileMatch = (values as string[]).includes(row.operational_profile);
              return partMatch && activeMatch && profileMatch;
            }),
          });
        },
        _filters: {} as Record<string, unknown>,
      };
    },
  })),
}));

const { getSequenceForAttempt, sequenceHasEnoughItems } = await import("./queries");

describe("getSequenceForAttempt", () => {
  it("é determinístico para o mesmo attemptId", async () => {
    const a = await getSequenceForAttempt("attempt-1", null);
    const b = await getSequenceForAttempt("attempt-1", null);
    expect(a).toEqual(b);
  });

  it("produz sequências diferentes para attemptIds diferentes", async () => {
    const a = await getSequenceForAttempt("attempt-1", null);
    const b = await getSequenceForAttempt("attempt-2", null);
    expect(a).not.toEqual(b);
  });

  it("respeita o tamanho de cada parte e não repete itens", async () => {
    const sequence = await getSequenceForAttempt("attempt-3", null);
    expect(sequence.part1).toHaveLength(4);
    expect(sequence.part2).toHaveLength(10);
    expect(sequence.part3).toHaveLength(4);
    expect(sequence.part4).toHaveLength(1);
    expect(sequenceHasEnoughItems(sequence)).toBe(true);

    const part1Ids = new Set(sequence.part1.map((p) => p.id));
    expect(part1Ids.size).toBe(4);
  });

  it("Parte 3 sempre traz as 2 primeiras concretas e as 2 últimas abstratas", async () => {
    for (const attemptId of ["attempt-a", "attempt-b", "attempt-c"]) {
      const sequence = await getSequenceForAttempt(attemptId, null);
      const [first, second, third, fourth] = sequence.part3.map((p) => p.id);
      expect(first).not.toContain("abstract");
      expect(second).not.toContain("abstract");
      expect(third).toContain("abstract");
      expect(fourth).toContain("abstract");
    }
  });

  it("sequenceHasEnoughItems detecta pool insuficiente", () => {
    expect(
      sequenceHasEnoughItems({
        part1: [],
        part2: [],
        part3: [],
        part4: [],
      }),
    ).toBe(false);
  });
});
