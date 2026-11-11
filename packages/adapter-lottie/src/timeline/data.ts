import type { CustomLayer } from "@swarmloom/core";

/** Custom layer task (and renderer key) of the keyframe timeline. */
export const TIMELINE_TASK = "anim:timeline";
/** Plugin name listed in `Blueprint.plugins`. */
export const TIMELINE_PLUGIN = "anim:timeline";

/** Longest cycle a timeline accepts, ms. */
export const MAX_TIMELINE_MS = 600_000;
/** Most keyframe times kept from layer data. */
export const MAX_TIMELINE_KEYS = 256;

/**
 * `CustomLayer.data` of an `anim:timeline` layer. The layer box is the strip the bar is drawn in,
 * usually just under the animated element.
 */
export interface AnimTimelineData {
  /** Layer id of the animated element; its plugin registers an `AnimTarget` on the layer element. */
  target?: string;
  /** Length of one cycle, ms. */
  duration: number;
  /**
   * Keyframe times, ms within the cycle. Empty: the bar shows generic quarter marks.
   * Decimated to what fits the bar.
   */
  keyframes: number[];
  /** Where the playhead rests before the scrub: the pose the static weave shows, ms. Default 0. */
  rest?: number;
  /** Colour scheme of the content under the bar (picks neutral or light ink). Default "light". */
  scheme?: "light" | "dark";
}

/** Validated timeline data. */
export interface TimelineSpec {
  target: string | null;
  duration: number;
  /** Mark positions as fractions of the bar, sorted and unique. */
  marks: number[];
  /** Rest position as a fraction of the bar. */
  rest: number;
  scheme: "light" | "dark";
}

const GENERIC_MARKS = [0, 0.25, 0.5, 0.75, 1];

function clamp01(v: number): number {
  return v > 0 ? Math.min(v, 1) : 0;
}

/**
 * Reads and validates the data of an `anim:timeline` layer (blueprints may come from storage, so
 * nothing is trusted). Returns null when the layer cannot be drawn (no positive duration).
 */
export function readTimeline(layer: CustomLayer, maxMarks: number): TimelineSpec | null {
  const data = (typeof layer.data === "object" && layer.data !== null ? layer.data : {}) as Partial<AnimTimelineData>;
  const duration = data.duration;
  if (typeof duration !== "number" || !(duration > 0) || duration > MAX_TIMELINE_MS) return null;
  const times = Array.isArray(data.keyframes) ? data.keyframes.slice(0, MAX_TIMELINE_KEYS) : [];
  const fractions = new Set<number>();
  for (const t of times) {
    if (typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= duration) {
      fractions.add(Math.round((t / duration) * 1e4) / 1e4);
    }
  }
  const sorted = fractions.size > 0 ? [...fractions].sort((a, b) => a - b) : GENERIC_MARKS;
  const rest = typeof data.rest === "number" && Number.isFinite(data.rest) ? clamp01(data.rest / duration) : 0;
  const target =
    typeof data.target === "string" && data.target.length > 0 && data.target.length <= 256 ? data.target : null;
  return {
    target,
    duration,
    marks: decimate(sorted, Math.max(2, Math.floor(maxMarks))),
    rest,
    scheme: data.scheme === "dark" ? "dark" : "light",
  };
}

/**
 * Picks at most `max` values from a sorted list, evenly spread and always keeping the first and
 * last, so a bar never shows more diamonds than it can fit.
 */
export function decimate(sorted: readonly number[], max: number): number[] {
  if (sorted.length <= max) return [...sorted];
  if (max <= 1) return sorted.slice(0, Math.max(0, max));
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(sorted[Math.round((i * (sorted.length - 1)) / (max - 1))] as number);
  return [...new Set(out)];
}
