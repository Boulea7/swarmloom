import { describe, expect, it } from "vitest";
import { createRng } from "../src/index";

const take = (rng: () => number, n: number): number[] => Array.from({ length: n }, () => rng());

describe("createRng", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = take(createRng(7), 1000);
    expect(take(createRng(7), 1000)).toEqual(a);
    expect(take(createRng(8), 1000)).not.toEqual(a);
    expect(a.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("keeps the mulberry32 sequence stable (exports depend on it)", () => {
    expect(take(createRng(42), 3)).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  });

  it("rejects non-finite seeds", () => {
    expect(() => createRng(Number.NaN)).toThrow(TypeError);
  });
});
