import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng";
import { DEFAULT_BPM, eighthMs, quantize } from "../../src/sound/quantize";

describe("quantize", () => {
  it("snaps forward to the eighth-note grid counted from t = 0", () => {
    const step = eighthMs(DEFAULT_BPM);
    expect(step).toBeCloseTo(267.857, 3);
    expect(quantize(0, DEFAULT_BPM)).toBe(0);
    expect(quantize(1, DEFAULT_BPM)).toBeCloseTo(step, 9);
    expect(quantize(step, DEFAULT_BPM)).toBe(step);
    expect(quantize(-50, DEFAULT_BPM)).toBe(0);
    expect(quantize(1000, 120)).toBe(1000);
    expect(quantize(1001, 120)).toBe(1250);
  });

  it("is pure, monotone, idempotent and never moves a time by a full eighth", () => {
    const rng = createRng(7);
    const times = Array.from({ length: 2000 }, () => rng() * 60000).sort((a, b) => a - b);
    for (const bpm of [DEFAULT_BPM, 97.3, 180]) {
      const step = eighthMs(bpm);
      let previous = -1;
      for (const t of times) {
        const q = quantize(t, bpm);
        expect(q).toBeGreaterThanOrEqual(previous);
        expect(q).toBeGreaterThanOrEqual(t - 1e-6);
        expect(q - t).toBeLessThan(step);
        expect(quantize(q, bpm)).toBe(q);
        expect(quantize(t, bpm)).toBe(q);
        previous = q;
      }
    }
  });

  it("rejects non-finite times and non-positive tempos", () => {
    expect(() => quantize(Number.NaN, DEFAULT_BPM)).toThrow(TypeError);
    expect(() => quantize(Number.POSITIVE_INFINITY, DEFAULT_BPM)).toThrow(TypeError);
    expect(() => quantize(100, 0)).toThrow(RangeError);
    expect(() => quantize(100, -120)).toThrow(RangeError);
    expect(() => quantize(100, Number.NaN)).toThrow(RangeError);
  });
});
