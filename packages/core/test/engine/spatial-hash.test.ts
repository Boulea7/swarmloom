import { describe, expect, it } from "vitest";
import { SpatialHash } from "../../src/engine/spatial-hash";
import { createRng } from "../../src/rng";

describe("SpatialHash", () => {
  it("returns exactly the brute-force neighbours, across negative cells and rebuilds", () => {
    const rng = createRng(42);
    const hash = new SpatialHash(90, 8);
    const out = new Int32Array(512);
    for (const count of [5, 300, 40]) {
      // Points spread over negative and positive coordinates, a few duplicates on cell borders.
      const xs = Float64Array.from({ length: count }, (_, i) => (i % 17 === 0 ? 180 : rng() * 1600 - 800));
      const ys = Float64Array.from({ length: count }, (_, i) => (i % 17 === 0 ? -90 : rng() * 1200 - 600));
      hash.rebuild(xs, ys, count);
      for (let q = 0; q < 60; q++) {
        const x = rng() * 1800 - 900;
        const y = rng() * 1400 - 700;
        const r = q === 0 ? 0 : rng() * 200;
        const got = Array.from(out.subarray(0, hash.query(x, y, r, out))).sort((a, b) => a - b);
        const want: number[] = [];
        for (let i = 0; i < count; i++) {
          const dx = (xs[i] as number) - x;
          const dy = (ys[i] as number) - y;
          if (dx * dx + dy * dy <= r * r) want.push(i);
        }
        expect(got).toEqual(want);
      }
    }
  });

  it("caps results at the output length and rejects a bad cell size", () => {
    const hash = new SpatialHash(10);
    hash.rebuild([0, 1, 2, 3], [0, 0, 0, 0], 4);
    expect(hash.query(0, 0, 50, new Int32Array(2))).toBe(2);
    expect(() => new SpatialHash(0)).toThrow(RangeError);
  });
});
