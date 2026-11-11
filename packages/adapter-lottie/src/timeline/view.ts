import type { TimelineSpec } from "./data";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Brand colours (contracts/brand.md): neutral line, Loom Indigo marks, accent playhead. */
const COLORS = {
  light: { track: "rgba(11,11,18,.12)", fill: "rgba(11,11,18,.28)", mark: "#5B5BF7", head: "#FF4F7B" },
  dark: { track: "rgba(255,255,255,.14)", fill: "rgba(255,255,255,.32)", mark: "#8585FA", head: "#FF4F7B" },
} as const;

/** Horizontal inset of the bar inside the layer box, px. */
export const BAR_INSET = 10;
/** Half size of a keyframe diamond, px. */
const MARK_R = 5;
/** Half height of the playhead line, px. */
const HEAD_HALF = 11;
/** Track thickness, px. */
const TRACK_H = 4;

/** Bar geometry of a timeline box (local coordinates of the layer box). */
export interface BarGeometry {
  /** Left end of the bar. */
  x0: number;
  /** Bar length. */
  len: number;
  /** Vertical centre of the bar. */
  cy: number;
}

/** Where the bar sits inside a box of `w` x `h`. */
export function barGeometry(w: number, h: number): BarGeometry {
  const inset = Math.min(BAR_INSET, w / 4);
  return { x0: inset, len: Math.max(1, w - 2 * inset), cy: h / 2 };
}

/** What the view shows; every field is set by the renderer from stage and task state. */
export interface TimelineFrame {
  /** Drawn share of the bar, 0..1. */
  bar: number;
  /** Number of diamonds shown (from the left). */
  marks: number;
  /** Playhead position as a fraction of the bar, or null when hidden. */
  head: number | null;
}

function el<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string>) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * The DOM of one mounted timeline: a track that is dragged out from the left, diamond keyframe
 * marks and a playhead. Decorative (`aria-hidden`); updates touch only attributes that changed.
 */
export class TimelineView {
  readonly root: SVGSVGElement;
  readonly #spec: TimelineSpec;
  readonly #geo: BarGeometry;
  readonly #track: SVGRectElement;
  readonly #played: SVGRectElement;
  readonly #marks: SVGPathElement[];
  readonly #head: SVGGElement;
  #shown: TimelineFrame = { bar: -1, marks: -1, head: -2 };

  constructor(doc: Document, spec: TimelineSpec, w: number, h: number) {
    this.#spec = spec;
    const geo = barGeometry(w, h);
    this.#geo = geo;
    const c = COLORS[spec.scheme];
    const root = el(doc, "svg", {
      width: "100%",
      height: "100%",
      viewBox: `0 0 ${fmt(w)} ${fmt(h)}`,
      overflow: "visible",
      "aria-hidden": "true",
      focusable: "false",
    });
    root.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none";
    const y = fmt(geo.cy - TRACK_H / 2);
    this.#track = el(doc, "rect", { x: fmt(geo.x0), y, height: String(TRACK_H), rx: "2", fill: c.track, width: "0" });
    this.#played = el(doc, "rect", { x: fmt(geo.x0), y, height: String(TRACK_H), rx: "2", fill: c.fill, width: "0" });
    root.append(this.#track, this.#played);
    this.#marks = spec.marks.map((f) => {
      const x = geo.x0 + f * geo.len;
      const d = `M${fmt(x)} ${fmt(geo.cy - MARK_R)}l${MARK_R} ${MARK_R}l${-MARK_R} ${MARK_R}l${-MARK_R} ${-MARK_R}Z`;
      const mark = el(doc, "path", { d, fill: c.mark, visibility: "hidden" });
      root.append(mark);
      return mark;
    });
    this.#head = el(doc, "g", { visibility: "hidden" });
    const top = geo.cy - HEAD_HALF;
    this.#head.append(
      el(doc, "line", {
        x1: "0",
        x2: "0",
        y1: fmt(top),
        y2: fmt(geo.cy + HEAD_HALF),
        stroke: c.head,
        "stroke-width": "2",
        "stroke-linecap": "round",
      }),
      el(doc, "path", { d: `M-5 ${fmt(top - 6)}h10v4l-5 4l-5 -4Z`, fill: c.head }),
    );
    root.append(this.#head);
    this.root = root;
  }

  /** Stage x (relative to the layer box) of a bar fraction. */
  xAt(f: number): number {
    return this.#geo.x0 + f * this.#geo.len;
  }

  /** Draws `frame`; unchanged parts are left alone. */
  render(frame: TimelineFrame): void {
    const prev = this.#shown;
    const geo = this.#geo;
    if (frame.bar !== prev.bar) {
      this.#track.setAttribute("width", fmt(geo.len * frame.bar));
      this.root.style.visibility = frame.bar > 0 ? "" : "hidden";
    }
    if (frame.marks !== prev.marks) {
      this.#marks.forEach((m, i) => {
        m.setAttribute("visibility", i < frame.marks ? "visible" : "hidden");
      });
    }
    if (frame.head !== prev.head) {
      const visible = frame.head !== null;
      this.#head.setAttribute("visibility", visible ? "visible" : "hidden");
      const f = visible ? (frame.head as number) : 0;
      if (visible) this.#head.setAttribute("transform", `translate(${fmt(geo.x0 + f * geo.len)} 0)`);
      this.#played.setAttribute("width", fmt(geo.len * f));
    }
    this.#shown = { ...frame };
  }

  /** Number of keyframe marks the bar shows. */
  get markCount(): number {
    return this.#spec.marks.length;
  }
}
