/**
 * Typing cadence planner (pure). Produces the keystroke schedule of one text: natural and slightly
 * irregular for short labels (bursts and slower stretches, longer gaps between words, a beat after
 * punctuation and line breaks, rare thinking pauses at clause boundaries), compressed smoothly for
 * long texts, which reveal a word or short phrase per stroke so a paragraph never dominates the build.
 */

import type { Rng } from "../types";
import { isClauseEnd, isLineBreak, isWhitespace } from "./text-units";
import {
  clamp,
  KEY_JITTER,
  MAX_STROKES,
  MIN_KEY_GAP_MS,
  MIN_STROKE_MS,
  NEWLINE_PAUSE_MS,
  PUNCTUATION_PAUSE_MS,
  pick,
  RHYTHM_DRIFT,
  RHYTHM_MAX,
  RHYTHM_MIN,
  THINK_CHANCE,
  THINK_PAUSE_MS,
  TYPE_KEY_MS,
  TYPE_MAX_MS,
  WORD_GAP,
} from "./timing";

export interface Stroke {
  /** Units (graphemes) visible after this stroke, cumulative. */
  end: number;
  /** Wait before this stroke, engine ms. */
  delay: number;
  /** Sound of the stroke: a key, or the deeper space/return key when its first unit is whitespace. */
  sound: "key" | "space";
  /** Key accent 0..1 (stronger after a pause). */
  vel: number;
}

export interface TypingOptions {
  /** Pace multiplier on the natural budget (< 1 is faster). Default 1. */
  scale?: number;
  /** Upper bound of the whole schedule, engine ms. Default {@link TYPE_MAX_MS}. */
  maxMs?: number;
}

/**
 * Total typing time for `count` units: about `TYPE_KEY_MS` each for short texts, saturating
 * towards `maxMs` for long ones.
 */
export function typingBudget(count: number, opts: TypingOptions = {}): number {
  const maxMs = opts.maxMs ?? TYPE_MAX_MS;
  const scale = opts.scale ?? 1;
  if (!(count > 0) || !(maxMs > 0) || !(scale > 0)) return 0;
  return maxMs * (1 - Math.exp((-count * TYPE_KEY_MS * scale) / maxMs));
}

/** Number of strokes for `count` units: one per unit while that stays readable, then capped. */
export function strokeCount(count: number, budget: number): number {
  if (!(count > 0) || !(budget > 0)) return 0;
  return Math.max(1, Math.min(count, MAX_STROKES, Math.floor(budget / MIN_STROKE_MS)));
}

/**
 * Stroke boundaries. With fewer strokes than units, each nominal boundary moves forward to the
 * next word break within half a stroke, so chunks read as words (CJK without spaces stays in
 * evenly sized phrases).
 */
function chunkEnds(units: readonly string[], strokes: number): number[] {
  const count = units.length;
  const ends: number[] = [];
  const span = count / strokes;
  let start = 0;
  for (let k = 0; k < strokes; k++) {
    let end = k === strokes - 1 ? count : Math.max(start + 1, Math.round((k + 1) * span));
    if (span > 1 && end < count) {
      const limit = Math.min(count - 1, end + Math.floor(span / 2));
      for (let j = end; j <= limit; j++) {
        if (isWhitespace(units[j])) {
          end = j;
          break;
        }
      }
    }
    // Leave at least one unit per remaining stroke.
    end = Math.min(end, count - (strokes - 1 - k));
    if (end <= start) end = start + 1;
    ends.push(end);
    start = end;
  }
  return ends;
}

/**
 * Plans the strokes for `units` (graphemes). The delays add up to the typing budget (plus small
 * minimum-gap corrections); pauses are budgeted in letter units, so for long texts they compress
 * together with the letters.
 */
export function planTyping(units: readonly string[], rng: Rng, opts: TypingOptions = {}): Stroke[] {
  const count = units.length;
  const budget = typingBudget(count, opts);
  const strokes = strokeCount(count, budget);
  if (strokes === 0) return [];

  const ends = chunkEnds(units, strokes);
  const weights: number[] = [];
  const sounds: Array<"key" | "space"> = [];
  const accents: boolean[] = [];
  let rhythm = 1;
  let start = 0;
  for (let k = 0; k < ends.length; k++) {
    const end = ends[k] ?? count;
    const lead = units[start];
    // Rhythm drifts slowly: runs of quick strokes (bursts) alternate with slower stretches.
    rhythm = clamp(rhythm + (rng() - 0.5) * RHYTHM_DRIFT, RHYTHM_MIN, RHYTHM_MAX);
    let weight = (end - start) * rhythm * (1 + (rng() * 2 - 1) * KEY_JITTER);
    let pauseMs = 0;
    if (isLineBreak(lead)) pauseMs += pick(rng, NEWLINE_PAUSE_MS);
    else if (isWhitespace(lead)) weight *= pick(rng, WORD_GAP);
    const prev = units[start - 1];
    if (k > 0 && isClauseEnd(prev)) {
      pauseMs += pick(rng, PUNCTUATION_PAUSE_MS);
      if (rng() < THINK_CHANCE) pauseMs += pick(rng, THINK_PAUSE_MS);
    }
    // The first stroke follows the opening breath, so it is never slow.
    weights.push(k === 0 ? Math.min(weight, 1) : weight + pauseMs / TYPE_KEY_MS);
    sounds.push(isWhitespace(lead) ? "space" : "key");
    accents.push(k === 0 || pauseMs > 0);
    start = end;
  }

  const total = weights.reduce((sum, w) => sum + w, 0);
  const msPerWeight = budget / total;
  return ends.map((end, i) => {
    const delay = Math.max(MIN_KEY_GAP_MS, (weights[i] ?? 0) * msPerWeight);
    const base = sounds[i] === "space" ? 0.55 + 0.25 * rng() : 0.45 + 0.35 * rng();
    const vel = clamp(base + (accents[i] ? 0.15 : 0), 0, 1);
    return { end, delay, sound: sounds[i] ?? "key", vel };
  });
}
