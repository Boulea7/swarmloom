import { LottieError } from "../errors";
import { finite, isRecord } from "./json";

/** Linear map from a composition's local frame to the root composition frame. */
interface TimeMap {
  scale: number;
  offset: number;
}

export interface KeyTimeLimits {
  maxKeyframes: number;
  /** Upper bound on layer instances visited (a precomposition used n times is visited n times). */
  maxVisits: number;
}

export interface KeyTimes {
  /** Root-composition frames of keyframes. */
  keyframes: number[];
  /** Root-composition frames of layer in/out points. */
  bounds: number[];
  /** Keyframes seen (before deduplication). */
  count: number;
}

const MAX_NESTING = 32;

/**
 * Calls `fn` with the keyframe times of every animated property inside `node`
 * (`{ a: 1, k: [{ t, s, ... }, ...] }`). Iterative, so deep shape trees cannot overflow the stack.
 */
function eachKeyframeTime(node: unknown, fn: (t: number) => void): void {
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (const item of v) if (typeof item === "object" && item !== null) stack.push(item);
      continue;
    }
    if (!isRecord(v)) continue;
    const k = v.k;
    if (Array.isArray(k) && k.length > 0 && isRecord(k[0]) && finite(k[0].t)) {
      for (const kf of k) if (isRecord(kf) && finite(kf.t)) fn(kf.t);
    }
    for (const key in v) {
      // Nested precompositions live in assets and are visited through their layer.
      if (key === "layers") continue;
      const child = v[key];
      if (typeof child === "object" && child !== null) stack.push(child);
    }
  }
}

/**
 * Collects keyframe times of an animation in root-composition frames.
 *
 * Layer properties are keyed in layer time (`t + st` in the parent composition); a
 * precomposition layer maps its children through its start time and stretch (`sr`). Children of
 * time-remapped precompositions (`tm`) are skipped because their mapping is not linear; the
 * remap keyframes themselves are kept.
 *
 * @throws LottieError on precomposition cycles, nesting deeper than 32 or past the limits.
 */
export function collectKeyTimes(
  layers: readonly unknown[],
  precomps: ReadonlyMap<string, readonly unknown[]>,
  limits: KeyTimeLimits,
): KeyTimes {
  const keyframes: number[] = [];
  const bounds: number[] = [];
  let count = 0;
  let visits = 0;

  const visit = (list: readonly unknown[], map: TimeMap, chain: string[]): void => {
    if (chain.length > MAX_NESTING) {
      throw new LottieError("too-large", `Precompositions are nested more than ${MAX_NESTING} levels deep.`);
    }
    for (const layer of list) {
      if (!isRecord(layer)) continue;
      if (++visits > limits.maxVisits) {
        throw new LottieError("too-large", "The animation reuses precompositions too many times.");
      }
      const st = finite(layer.st) ? layer.st : 0;
      const toRoot = (t: number): number => map.scale * t + map.offset;
      if (finite(layer.ip)) bounds.push(toRoot(layer.ip));
      if (finite(layer.op)) bounds.push(toRoot(layer.op));
      eachKeyframeTime(layer, (t) => {
        if (++count > limits.maxKeyframes) {
          throw new LottieError("too-large", `The animation has more than ${limits.maxKeyframes} keyframes.`);
        }
        keyframes.push(toRoot(t + st));
      });
      if (layer.ty !== 0 || typeof layer.refId !== "string") continue;
      const inner = precomps.get(layer.refId);
      if (!inner) continue;
      if (chain.includes(layer.refId)) {
        throw new LottieError("invalid", `Precomposition "${layer.refId}" contains itself.`);
      }
      if (layer.tm !== undefined) continue;
      const sr = finite(layer.sr) && layer.sr > 0 ? layer.sr : 1;
      visit(inner, { scale: map.scale * sr, offset: map.scale * st + map.offset }, [...chain, layer.refId]);
    }
  };

  visit(layers, { scale: 1, offset: 0 }, []);
  return { keyframes, bounds, count };
}

/** Sorted unique values within [lo, hi], rounded to 1/1000 frame. */
export function normalizeTimes(times: readonly number[], lo: number, hi: number): number[] {
  const out = new Set<number>();
  for (const t of times) {
    if (!Number.isFinite(t) || t < lo - 1e-6 || t > hi + 1e-6) continue;
    out.add(Math.round(Math.min(hi, Math.max(lo, t)) * 1000) / 1000);
  }
  return [...out].sort((a, b) => a - b);
}
