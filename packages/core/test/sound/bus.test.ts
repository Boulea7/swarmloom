import { describe, expect, it } from "vitest";
import { createLimiterCurve, LIMIT_CEILING, LIMIT_KNEE } from "../../src/sound/bus";

describe("limiter curve", () => {
  it("passes quiet samples unchanged and keeps loud ones below -1 dBFS", () => {
    const points = 2001;
    const curve = createLimiterCurve(points);
    const at = (x: number) => curve[Math.round(((x + 1) / 2) * (points - 1))] as number;
    for (const x of [0, 0.25, -0.5, LIMIT_KNEE]) expect(at(x)).toBeCloseTo(x, 6);
    expect(at(1)).toBeLessThan(LIMIT_CEILING);
    expect(at(-1)).toBeGreaterThan(-LIMIT_CEILING);
    for (let i = 1; i < points; i++) expect(curve[i] as number).toBeGreaterThanOrEqual(curve[i - 1] as number);
  });
});
