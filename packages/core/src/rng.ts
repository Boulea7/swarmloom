import type { Rng } from "./types";

/**
 * Creates a seeded PRNG (mulberry32) returning floats in [0, 1).
 *
 * The seed is coerced to an unsigned 32-bit integer. The output sequence is part of the
 * determinism contract (same seed + same clock = same frames and sounds): do not change it.
 */
export function createRng(seed: number): Rng {
  if (!Number.isFinite(seed)) throw new TypeError(`createRng() needs a finite seed, got ${seed}`);
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
