import { decimate, MAX_TIMELINE_KEYS, MAX_TIMELINE_MS } from "./data";

/** One cycle of the animations found on an element, for an `anim:timeline` layer. */
export interface CollectedKeyframes {
  /** Length of the longest animation's first cycle (delay included), ms. */
  duration: number;
  /** Keyframe times within the cycle, ms, sorted and unique. */
  keyframes: number[];
}

/** Options of {@link collectKeyframes}. */
export interface CollectKeyframesOptions {
  /** Include descendants (default true). */
  subtree?: boolean;
  /** Most keyframe times returned (default 256, evenly decimated). */
  maxKeyframes?: number;
}

const SMIL = "animate,animateTransform,animateMotion,animateColor,set";
const SMIL_NAMES = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set"]);
/** SMIL elements read per element tree. */
const MAX_SMIL = 2000;

/**
 * Parses a SMIL clock value (`2s`, `150ms`, `1.5`, `0.2min`, `1h`, `01:02.5`, `00:01:02`) to ms.
 * Returns null for anything else (`indefinite`, event or syncbase values).
 */
export function parseClock(value: string): number | null {
  const v = value.trim();
  const full = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v);
  if (full) {
    const [h, m, s] = [Number(full[1] ?? 0), Number(full[2]), Number(full[3])];
    return ((h * 60 + m) * 60 + s) * 1000;
  }
  const count = /^([+-]?\d*\.?\d+)(h|min|s|ms)?$/.exec(v);
  if (!count) return null;
  const n = Number(count[1]);
  const unit = count[2] ?? "s";
  const scale = unit === "h" ? 3_600_000 : unit === "min" ? 60_000 : unit === "ms" ? 1 : 1000;
  return Number.isFinite(n) ? n * scale : null;
}

interface Collector {
  times: number[];
  end: number;
}

/** Web Animations: CSS animations and transitions, `element.animate()`. */
function collectWebAnimations(el: Element, subtree: boolean, out: Collector): void {
  const getAnimations = (el as { getAnimations?: (o?: { subtree?: boolean }) => Animation[] }).getAnimations;
  if (typeof getAnimations !== "function") return;
  for (const animation of getAnimations.call(el, { subtree })) {
    const effect = animation.effect as KeyframeEffect | null;
    if (!effect || typeof effect.getComputedTiming !== "function") continue;
    const timing = effect.getComputedTiming();
    const duration = Number(timing.duration);
    if (!(duration > 0 && Number.isFinite(duration))) continue;
    const start = Math.max(0, Number(timing.delay) || 0);
    out.end = Math.max(out.end, start + duration);
    const frames = typeof effect.getKeyframes === "function" ? effect.getKeyframes() : [];
    for (const kf of frames) {
      const offset = (kf as ComputedKeyframe).computedOffset;
      if (typeof offset === "number" && offset >= 0 && offset <= 1) out.times.push(start + offset * duration);
    }
  }
}

/** SVG SMIL animation elements: `begin` (first offset value), `dur` and `keyTimes`. */
function collectSmil(el: Element, subtree: boolean, out: Collector): void {
  const nodes = SMIL_NAMES.has(el.localName) ? [el] : [];
  if (subtree) nodes.push(...Array.from(el.querySelectorAll(SMIL)).slice(0, MAX_SMIL));
  for (const node of nodes) {
    const begin = parseClock((node.getAttribute("begin") ?? "0").split(";")[0] ?? "0");
    const dur = parseClock(node.getAttribute("dur") ?? "");
    if (begin === null || dur === null || !(dur > 0)) continue;
    const start = Math.max(0, begin);
    out.end = Math.max(out.end, start + dur);
    const keyTimes = (node.getAttribute("keyTimes") ?? "")
      .split(";")
      .map((s) => Number.parseFloat(s))
      .filter((k) => k >= 0 && k <= 1);
    for (const k of keyTimes.length > 0 ? keyTimes : [0, 1]) out.times.push(start + k * dur);
  }
}

/**
 * Reads the keyframes of the animations running on an element, for the `anim:timeline`
 * choreography of HTML and SVG content: Web Animations (`getAnimations()`: CSS animations and
 * transitions, script-made animations) and SVG SMIL elements (`begin` offset, `dur`, `keyTimes`).
 * Event-based and indefinite timings are skipped. Only one cycle is described.
 *
 * @returns null when nothing animates with a finite duration.
 */
export function collectKeyframes(el: Element, options: CollectKeyframesOptions = {}): CollectedKeyframes | null {
  const subtree = options.subtree ?? true;
  const out: Collector = { times: [], end: 0 };
  collectWebAnimations(el, subtree, out);
  collectSmil(el, subtree, out);
  if (!(out.end > 0)) return null;
  const duration = Math.min(out.end, MAX_TIMELINE_MS);
  const unique = new Set<number>();
  for (const t of out.times) if (t >= 0 && t <= duration) unique.add(Math.round(t * 10) / 10);
  const sorted = [...unique].sort((a, b) => a - b);
  const max = Math.max(2, Math.min(options.maxKeyframes ?? MAX_TIMELINE_KEYS, MAX_TIMELINE_KEYS));
  return { duration, keyframes: decimate(sorted, max) };
}
