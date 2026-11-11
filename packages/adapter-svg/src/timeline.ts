import type { CustomLayer, Plugin, Rect } from "@swarmloom/core";
import { SVG_NS } from "./units";

/**
 * Keyframe-timeline seam (integration-notes item 11). When the host passes a plugin named
 * `anim:timeline` in the load context (exported by @swarmloom/adapter-lottie; looked up by name,
 * never imported), an animated drawing gets one `anim:timeline` custom layer in a band under the
 * drawing: its task drops the keyframe diamonds and scrubs the playhead before the drawing's own
 * animation plays. Without the plugin the blueprint is unchanged.
 */

/** Plugin name and task key of the keyframe timeline. */
export const TIMELINE_PLUGIN = "anim:timeline";

/**
 * `CustomLayer.data` of an `anim:timeline` layer: the shape the plugin from
 * @swarmloom/adapter-lottie reads (its optional `target` layer id is left out, as no SVG layer
 * registers an animation target).
 */
export interface TimelineData {
  /** Length of one cycle (latest begin plus duration), ms, at most {@link MAX_TIMELINE_MS}. */
  duration: number;
  /** Keyframe times within the cycle, ms, ascending and unique. */
  keyframes: number[];
  /** Playhead position of the woven pose, ms (0: the authored, un-animated drawing). */
  rest?: number;
  /** Colour scheme of the content under the bar. */
  scheme?: "light" | "dark";
}

/** Longest cycle the timeline plugin accepts, ms. */
export const MAX_TIMELINE_MS = 600_000;
/** Height of the band added under the drawing for the timeline bar, stage px. */
export const TIMELINE_BAND = 44;
const MAX_KEYFRAMES = 64;
const BAR_H = 28;
const BAR_MARGIN = 12;
const ANIMATIONS = new Set(["animate", "animateTransform", "animateMotion", "set"]);

/**
 * The `anim:timeline` plugin among the host's plugins when it provides the task, else undefined
 * (no layer is added and the blueprint stays as it was).
 */
export function findTimelinePlugin(plugins: readonly Plugin[] | undefined): Plugin | undefined {
  if (!Array.isArray(plugins)) return undefined;
  return plugins.find((p) => p?.name === TIMELINE_PLUGIN && typeof p.tasks?.[TIMELINE_PLUGIN] === "function");
}

/** SMIL clock value in ms ("2s", "150ms", "0.5", "1min", "00:01.5", "01:00:02"), or null. */
export function parseClock(value: string): number | null {
  const v = value.trim();
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(v);
  if (clock) return ((Number(clock[1] ?? 0) * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000;
  const count = /^(\d+(?:\.\d+)?|\.\d+)(h|min|s|ms)?$/.exec(v);
  if (!count) return null;
  const n = Number(count[1]);
  const unit = count[2] ?? "s";
  return n * (unit === "h" ? 3_600_000 : unit === "min" ? 60_000 : unit === "ms" ? 1 : 1000);
}

/** First plain offset of a `begin` list in ms (default 0); null when it only starts on events or other animations. */
function beginOf(el: Element): number | null {
  const attr = el.getAttribute("begin");
  if (attr === null) return 0;
  for (const part of attr.split(";")) {
    const m = /^\s*([+-])?\s*(.+?)\s*$/.exec(part);
    const ms = m?.[2] ? parseClock(m[2]) : null;
    if (ms !== null) return m?.[1] === "-" ? -ms : ms;
  }
  return null;
}

/** Fractions of the simple duration at which an animation has keyframes. */
function fractionsOf(el: Element): number[] {
  const keyTimes = el.getAttribute("keyTimes");
  if (keyTimes) {
    const list = keyTimes.split(";").map(Number);
    if (list.every((t) => Number.isFinite(t) && t >= 0 && t <= 1)) return list;
  }
  const values = el
    .getAttribute("values")
    ?.split(";")
    .filter((s) => s.trim() !== "");
  if (values && values.length > 1) return values.map((_, i) => i / (values.length - 1));
  return el.localName === "set" ? [0] : [0, 1];
}

/**
 * Keyframe timeline of the SMIL animations in `root`, from their timing attributes: plain `begin`
 * offsets, `dur`, and `keyTimes` or the number of `values`. Animations that start on events or on
 * other animations are left out; only the first cycle is described. Returns null when nothing has
 * a resolvable time.
 */
export function collectSmilTimeline(root: Element): TimelineData | null {
  const times = new Set<number>();
  let duration = 0;
  for (const el of Array.from(root.getElementsByTagNameNS(SVG_NS, "*"))) {
    if (!ANIMATIONS.has(el.localName)) continue;
    const begin = beginOf(el);
    if (begin === null) continue;
    const start = Math.max(0, begin);
    const dur = parseClock(el.getAttribute("dur") ?? "");
    const span = dur ?? 0;
    for (const f of dur === null ? [0] : fractionsOf(el)) times.add(Math.round(start + f * span));
    duration = Math.max(duration, start + span);
  }
  duration = Math.min(Math.round(duration), MAX_TIMELINE_MS);
  if (times.size === 0 || !(duration > 0)) return null;
  const keyframes = [...times].filter((t) => t <= duration).sort((a, b) => a - b);
  return { duration, keyframes: keyframes.slice(0, MAX_KEYFRAMES), rest: 0 };
}

/**
 * The `anim:timeline` layer for a timeline: a bar centred in `band` (the strip added under the
 * drawing), built after every layer with a priority below `after`.
 */
export function timelineLayer(id: string, data: TimelineData, band: Rect, after: number): CustomLayer {
  const h = Math.min(BAR_H, band.h);
  const margin = Math.min(BAR_MARGIN, band.w / 4);
  return {
    id,
    kind: "custom",
    task: TIMELINE_PLUGIN,
    box: { x: band.x + margin, y: band.y + (band.h - h) / 2, w: Math.max(8, band.w - 2 * margin), h },
    priority: after + 1,
    data,
    meta: { keyframes: data.keyframes.length },
  };
}
