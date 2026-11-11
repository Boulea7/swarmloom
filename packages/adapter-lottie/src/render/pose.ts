/** Which frame is woven as the static pose. */
export type PoseChoice = "auto" | "first" | "last" | number;

/** A candidate frame and how much of the animation it shows. */
export interface ScoredFrame {
  /** Frame index from the in point. */
  index: number;
  /** Visible painted area, any consistent unit. */
  score: number;
  /** True when a keyframe sits on this frame (an authored pose). */
  key: boolean;
}

/** The final frame counts as the settled pose when it shows at least this share of the best. */
const SETTLED_SHARE = 0.98;
/** Scores within this share of the best tie; ties prefer keyframes, then earlier frames. */
const TIE_SHARE = 0.002;
/** Evenly spaced samples added to the keyframe candidates. */
const SAMPLES = 16;

/**
 * Candidate frame indices for the automatic pose: every keyframe (deduplicated, at most
 * `max - SAMPLES - 1`, spread evenly), evenly spaced samples and the last frame.
 *
 * @param keyIndices Keyframe frame indices, sorted.
 * @param count Frames in one cycle.
 */
export function candidateFrames(keyIndices: readonly number[], count: number, max = 40): number[] {
  const last = Math.max(0, count - 1);
  const out = new Set<number>();
  const keys = keyIndices.filter((i) => i >= 0 && i <= last);
  const room = Math.max(1, max - SAMPLES - 1);
  const step = keys.length > room ? keys.length / room : 1;
  for (let k = 0; k < keys.length && out.size < room; k += step) out.add(keys[Math.floor(k)] as number);
  for (let s = 0; s < SAMPLES; s++) out.add(Math.round((s * last) / Math.max(1, SAMPLES - 1)));
  out.add(last);
  return [...out].sort((a, b) => a - b);
}

/**
 * Picks the pose to weave from scored frames:
 *  - when the last frame is (almost) as full as the best one, the animation settles into its
 *    final pose (intro or reveal style): the last frame;
 *  - otherwise the frame with the most visible area; near-ties prefer keyframes, then earlier ones.
 */
export function choosePose(frames: readonly ScoredFrame[], last: number): number {
  if (frames.length === 0) return last;
  let best = 0;
  for (const f of frames) if (f.score > best) best = f.score;
  if (!(best > 0)) return last;
  const final = frames.find((f) => f.index === last);
  if (final && final.score >= best * SETTLED_SHARE) return last;
  const floor = best * (1 - TIE_SHARE);
  const ties = frames.filter((f) => f.score >= floor);
  const keyed = ties.filter((f) => f.key);
  const pool = keyed.length > 0 ? keyed : ties;
  return pool.reduce((a, b) => (b.index < a.index ? b : a)).index;
}

/** Resolves an explicit choice to a frame index; "auto" returns null. */
export function fixedPose(choice: PoseChoice, ip: number, count: number): number | null {
  const last = Math.max(0, count - 1);
  if (choice === "first") return 0;
  if (choice === "last") return last;
  if (typeof choice === "number" && Number.isFinite(choice))
    return Math.min(last, Math.max(0, Math.round(choice - ip)));
  return null;
}

const DRAWN = "path,rect,circle,ellipse,polygon,polyline,line,image,text";
/** Elements measured per frame; huge animations are scored on their first elements. */
const MAX_MEASURED = 4000;

function clamp01(v: number): number {
  return v > 0 ? Math.min(v, 1) : 0;
}

function numberAttr(el: Element, name: string, fallback: number): number {
  const v = Number.parseFloat(el.getAttribute(name) ?? "");
  return Number.isFinite(v) ? v : fallback;
}

/** Product of the `opacity` attributes of `el` and its ancestors up to `root` (lottie-web writes attributes). */
function opacityOf(el: Element, root: Element): number {
  let o = 1;
  for (let node: Element | null = el; node && node !== root && o > 0; node = node.parentElement) {
    o *= clamp01(numberAttr(node, "opacity", 1));
  }
  return o;
}

/**
 * Visible painted area of the frame currently shown in `svg`: bounding areas of drawn elements
 * (clipped to the viewport) times their opacity. Stroke-only shapes count their outline band
 * instead of their whole box, so a thin frame line does not outweigh a filled shape.
 * Hidden layers (`display: none`) measure as empty.
 */
export function visibleArea(svg: SVGSVGElement): number {
  const view = svg.getBoundingClientRect();
  if (!(view.width > 0 && view.height > 0)) return 0;
  let total = 0;
  let measured = 0;
  for (const el of Array.from(svg.querySelectorAll(DRAWN))) {
    if (measured++ >= MAX_MEASURED) break;
    if (el.closest("defs,clipPath,mask,pattern,marker,symbol")) continue;
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, view.right) - Math.max(r.left, view.left);
    const h = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
    if (!(w > 0 || h > 0)) continue;
    const bw = Math.max(0, w);
    const bh = Math.max(0, h);
    const solid = el.localName === "image" || el.localName === "text";
    const fill = solid ? 1 : el.getAttribute("fill") === "none" ? 0 : clamp01(numberAttr(el, "fill-opacity", 1));
    const stroke = el.getAttribute("stroke");
    const strokeOpacity = stroke && stroke !== "none" ? clamp01(numberAttr(el, "stroke-opacity", 1)) : 0;
    const band = (bw + bh) * Math.max(0, numberAttr(el, "stroke-width", 1)) * strokeOpacity;
    const area = Math.max(bw * bh * fill, band);
    if (area > 0) total += area * opacityOf(el, svg);
  }
  return total;
}
