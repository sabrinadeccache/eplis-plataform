import { describe, expect, it } from "vitest";
import { computeNextPosition, PART_ORDER, PART_SIZES } from "./state-machine";

describe("computeNextPosition", () => {
  it("avança para o próximo item dentro da mesma parte", () => {
    const next = computeNextPosition("part2", 3);
    expect(next).toEqual({ part: "part2", itemIndex: 4, stateLabel: "PART_2_SCENARIO" });
  });

  it("avança para a intro da próxima parte ao terminar o último item", () => {
    for (let i = 0; i < PART_ORDER.length - 1; i++) {
      const part = PART_ORDER[i];
      const lastIndex = PART_SIZES[part] - 1;
      const next = computeNextPosition(part, lastIndex);
      const expectedNextPart = PART_ORDER[i + 1];
      expect(next).toEqual(
        expect.objectContaining({ part: expectedNextPart, itemIndex: 0 }),
      );
    }
  });

  it("retorna null ao terminar o último item da última parte", () => {
    const lastPart = PART_ORDER[PART_ORDER.length - 1];
    const next = computeNextPosition(lastPart, PART_SIZES[lastPart] - 1);
    expect(next).toBeNull();
  });
});
