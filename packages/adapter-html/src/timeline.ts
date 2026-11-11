import type { CustomLayer, Layer, Plugin, Rect, Size } from "@swarmloom/core";

/**
 * Keyframe-timeline seam (integration-notes item 11). When the host passes a plugin named
 * `anim:timeline` in the load context (exported by @swarmloom/adapter-lottie; looked up by name,
 * never imported), each animated element of a full document gets an `anim:timeline` custom layer:
 * a mini timeline under the element whose task drops the keyframe diamonds and scrubs the playhead,
 * built after the page, before its animations play again on go live (decision C02). Without the
 * plugin the blueprint is unchanged.
 */

/** Plugin name and task key of the keyframe timeline. */
export const TIMELINE_PLUGIN = "anim:timeline";

/**
 * `CustomLayer.data` of an `anim:timeline` layer: the shape the plugin from
 * @swarmloom/adapter-lottie reads (its optional `target` layer id is left out, as no HTML layer
 * registers an animation target).
 */
export interface TimelineData {
  /** Length of one pass of the element's animations (delay included), ms, at most {@link MAX_TIMELINE_MS}. */
  duration: number;
  /** Keyframe times within the pass, ms, ascending and unique. */
  keyframes: number[];
  /** Playhead position of the captured pose, ms: the end for finite animations, the phase of a loop. */
  rest?: number;
}

/** Keyframe timeline of one animated element, with its box in document coordinates. */
export interface KeyframeTimeline extends TimelineData {
  target: Rect;
}

/** Most animated elements that get a timeline, so a busy page does not fill up with bars. */
export const MAX_TIMELINES = 6;
/** Longest pass the timeline plugin accepts, ms. */
export const MAX_TIMELINE_MS = 600_000;
const MAX_KEYFRAMES = 64;
const BAR_H = 28;
const BAR_GAP = 6;
const BAR_MIN_W = 120;
const BAR_MAX_W = 480;

/**
 * The `anim:timeline` plugin among the host's plugins when it provides the task, else undefined
 * (no layer is added and the blueprint stays as it was).
 */
export function findTimelinePlugin(plugins: readonly Plugin[] | undefined): Plugin | undefined {
  if (!Array.isArray(plugins)) return undefined;
  return plugins.find((p) => p?.name === TIMELINE_PLUGIN && typeof p.tasks?.[TIMELINE_PLUGIN] === "function");
}

interface Pending {
  times: Set<number>;
  duration: number;
  /** Pose of the first infinite animation (delay plus phase of a cycle), ms; null when all are finite. */
  loopPose: number | null;
}

function finiteMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Keyframe timings of the animated elements of a laid-out document, read through the Web
 * Animations API (CSS animations and transitions): keyframe offsets times the duration, after the
 * delay. Call it before the animations are frozen, as finished ones may leave the list; `phase` is
 * the pose infinite loops are frozen at (see `freezeAnimations`).
 */
export function readKeyframes(doc: Document, phase = 0.5): Map<Element, TimelineData> {
  const out = new Map<Element, TimelineData>();
  if (typeof doc.getAnimations !== "function") return out;
  const fraction = Number.isFinite(phase) ? Math.min(1, Math.max(0, phase)) : 0.5;
  const byTarget = new Map<Element, Pending>();
  for (const anim of doc.getAnimations()) {
    const effect = anim.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!target || typeof effect.getKeyframes !== "function") continue;
    const timing = effect.getComputedTiming();
    const dur = finiteMs(timing.duration);
    if (!(dur > 0)) continue;
    const delay = Math.max(0, finiteMs(timing.delay));
    let entry = byTarget.get(target);
    if (!entry) {
      entry = { times: new Set(), duration: 0, loopPose: null };
      byTarget.set(target, entry);
    }
    for (const k of effect.getKeyframes()) {
      const offset = k.computedOffset;
      if (typeof offset === "number" && offset >= 0 && offset <= 1) entry.times.add(Math.round(delay + offset * dur));
    }
    entry.duration = Math.max(entry.duration, delay + dur);
    if (timing.iterations === Number.POSITIVE_INFINITY) entry.loopPose ??= Math.round(delay + fraction * dur);
  }
  for (const [el, entry] of byTarget) {
    const duration = Math.min(Math.round(entry.duration), MAX_TIMELINE_MS);
    const keyframes = [...entry.times].filter((t) => t <= duration).sort((a, b) => a - b);
    if (keyframes.length === 0 || !(duration > 0)) continue;
    out.set(el, {
      duration,
      keyframes: keyframes.slice(0, MAX_KEYFRAMES),
      rest: Math.min(entry.loopPose ?? duration, duration),
    });
  }
  return out;
}

/**
 * Places the timings on their elements as laid out now (call it after the animations are frozen,
 * so boxes match the captured pose): document coordinates, top to bottom, zero-size elements
 * skipped, at most `max` of them.
 */
export function placeKeyframes(timings: ReadonlyMap<Element, TimelineData>, max = MAX_TIMELINES): KeyframeTimeline[] {
  const out: KeyframeTimeline[] = [];
  for (const [el, data] of timings) {
    const win = el.ownerDocument.defaultView;
    const r = el.getBoundingClientRect();
    if (!win || !(r.width > 0 && r.height > 0)) continue;
    out.push({ ...data, target: { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height } });
  }
  out.sort((a, b) => a.target.y - b.target.y || a.target.x - b.target.x);
  return out.slice(0, Math.max(0, max));
}

function maxOf(layers: readonly Layer[], pick: (l: Layer) => number | undefined): number {
  let max = 0;
  for (const l of layers) max = Math.max(max, pick(l) ?? 0);
  return max;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

/**
 * Where a bar for `target` can go without covering page content: under it, else above it, inside
 * the world. Layers that contain the target (its own box, sections, backgrounds) may sit under the
 * bar; any other layer in the way rules the slot out. Null when neither slot is free.
 */
function freeSlot(target: Rect, layers: readonly Layer[], world: Size): Rect | null {
  const w = Math.min(Math.max(BAR_MIN_W, target.w), BAR_MAX_W, world.w);
  const x = Math.max(0, Math.min(target.x, world.w - w));
  for (const y of [target.y + target.h + BAR_GAP, target.y - BAR_GAP - BAR_H]) {
    const slot = { x, y, w, h: BAR_H };
    if (y < 0 || y + BAR_H > world.h) continue;
    if (!layers.some((l) => overlaps(l.box, slot) && !contains(l.box, target))) return slot;
  }
  return null;
}

/**
 * `anim:timeline` layers for `timelines`: a bar under each element, or above it when the space
 * under it is taken, drawn above and built after every layer of `layers`. Elements with no free
 * slot get no bar, so a bar never covers page content (or another bar).
 */
export function timelineLayers(
  timelines: readonly KeyframeTimeline[],
  layers: readonly Layer[],
  world: Size,
): CustomLayer[] {
  const z = maxOf(layers, (l) => l.z) + 1;
  const priority = maxOf(layers, (l) => l.priority) + 1;
  const ids = new Set(layers.map((l) => l.id));
  const out: CustomLayer[] = [];
  for (const { target, ...data } of timelines) {
    const box = freeSlot(target, [...layers, ...out], world);
    if (!box) continue;
    // Page ids become layer ids, so a page could already use ours.
    let id = `swarmloom-timeline-${out.length}`;
    while (ids.has(id)) id += "-";
    const timeline: TimelineData = data;
    out.push({
      id,
      kind: "custom",
      task: TIMELINE_PLUGIN,
      box,
      z,
      priority,
      data: timeline,
      meta: { keyframes: timeline.keyframes.length },
    });
  }
  return out;
}
