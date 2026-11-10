import { n } from "./svg.ts";

/** Exponential ease-out (quint), used whenever something lands or settles. */
export const EASE_OUT = "cubic-bezier(.22,1,.36,1)";
/** Symmetric ease for cursor travel between tasks. */
export const EASE_IN_OUT = "cubic-bezier(.65,0,.35,1)";

/** One keyframe: `at` is the fraction of the loop (0..1); `ease` applies to the segment that starts here. */
export interface Frame {
  at: number;
  props: Record<string, string>;
  ease?: string;
}

/**
 * Serialises a CSS @keyframes rule. Frames are sorted, clamped to 0..1 and must include both ends so
 * the loop seam is explicit. Frames that share a percentage are merged (later props win).
 */
export function keyframes(name: string, frames: readonly Frame[]): string {
  if (!/^[a-z][a-z0-9-]*$/i.test(name)) throw new Error(`invalid keyframes name ${name}`);
  const byPct = new Map<string, Frame>();
  for (const f of [...frames].sort((a, b) => a.at - b.at)) {
    if (!(f.at >= 0 && f.at <= 1)) throw new Error(`keyframe ${name} at ${f.at} is outside 0..1`);
    const pct = `${n(f.at * 100)}%`;
    const prev = byPct.get(pct);
    byPct.set(pct, { at: f.at, props: { ...prev?.props, ...f.props }, ease: f.ease ?? prev?.ease });
  }
  if (!byPct.has("0%") || !byPct.has("100%")) throw new Error(`keyframes ${name} must define 0% and 100%`);
  const body = [...byPct.entries()]
    .map(([pct, f]) => {
      const decl = Object.entries(f.props).map(([k, v]) => `${k}:${v}`);
      if (f.ease) decl.push(`animation-timing-function:${f.ease}`);
      return `${pct}{${decl.join(";")}}`;
    })
    .join("");
  return `@keyframes ${name}{${body}}`;
}

/** CSS translate() in user units, with an optional rotation in degrees. */
export function move(x: number, y: number, rotate = 0): string {
  const t = `translate(${n(x)}px,${n(y)}px)`;
  return rotate ? `${t} rotate(${n(rotate)}deg)` : t;
}

/**
 * Small deterministic PRNG (mulberry32). Generated artwork must be byte-for-byte reproducible,
 * so nothing here may depend on Math.random or the clock.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Media query that guards every animation rule. */
export const MOTION_QUERY = "@media (prefers-reduced-motion:no-preference)";

/**
 * Wraps animation rules so they only apply when the viewer has not asked for reduced motion.
 * The un-animated base state of every artwork is its finished design, so reduced motion (and
 * renderers without CSS animation) simply show the final frame.
 */
export function motionOnly(rules: readonly string[]): string {
  return rules.length > 0 ? `${MOTION_QUERY}{${rules.join("")}}` : "";
}
