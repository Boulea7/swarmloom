import { isElement, isText } from "../dom/env";
import { px } from "../util/css";
import { type Capture, type ElInfo, type FlatChild, infoOf, rectOf } from "./state";

/**
 * Inline-level siblings that the walk emits as their own layers (form controls, buttons, sizeable
 * inline-blocks) can share a line with a text run. The run's layer spans the container's content
 * box, so without help its text would start at the line start and draw over the atom. A spacer of
 * the atom's footprint keeps the text where it was laid out.
 */
export interface RunNeighbours {
  /** Flat child emitted just before the run (on the run's first line when it is inline-level). */
  prev?: FlatChild | undefined;
  /** Flat child emitted just after the run. */
  next?: FlatChild | undefined;
}

export interface RunSpacers {
  lead: number;
  trail: number;
}

/** Vertical tolerance (px) when deciding whether two boxes sit on the same line. */
const LINE_SLOP = 1;
/** Trailing spacers are shrunk by this much so rounding never forces an extra line break. */
const WRAP_SAFETY = 1;

function inlineLevelAtom(cap: Capture, child: FlatChild | undefined): ElInfo | null {
  if (!child || !isElement(child.node)) return null;
  const info = infoOf(cap, child.node);
  if (!info.display.startsWith("inline") || info.position === "absolute" || info.position === "fixed") return null;
  const r = rectOf(info);
  return r.width > 0 && r.height > 0 ? info : null;
}

/** Client rects of a flat child of the run (text fragments or an inline element's line boxes). */
function fragments(cap: Capture, child: FlatChild): DOMRectList | DOMRect[] {
  const node = child.node;
  if (isText(node)) {
    cap.range.selectNodeContents(node);
    return cap.range.getClientRects();
  }
  if (isElement(node)) return node.getClientRects();
  return [];
}

function firstFragment(cap: Capture, run: readonly FlatChild[]): DOMRect | null {
  for (const child of run) {
    const list = fragments(cap, child);
    for (let i = 0; i < list.length; i++) {
      const r = list[i] as DOMRect;
      if (r.width > 0 || r.height > 0) return r;
    }
  }
  return null;
}

function lastFragment(cap: Capture, run: readonly FlatChild[]): DOMRect | null {
  for (let c = run.length - 1; c >= 0; c--) {
    const list = fragments(cap, run[c] as FlatChild);
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i] as DOMRect;
      if (r.width > 0 || r.height > 0) return r;
    }
  }
  return null;
}

function sameLine(a: DOMRect, b: DOMRect): boolean {
  return a.top < b.bottom - LINE_SLOP && a.bottom > b.top + LINE_SLOP;
}

/** Margin-box left/right edges of an atom in viewport coordinates. */
function marginEdges(info: ElInfo): { left: number; right: number } {
  const r = rectOf(info);
  return { left: r.left - px(info.cs.marginLeft), right: r.right + px(info.cs.marginRight) };
}

/** True when the run's lines start at the inline-start edge of the content box. */
function startAligned(cs: CSSStyleDeclaration, rtl: boolean): boolean {
  const a = cs.textAlign;
  return a === "start" || a === "justify" || a === "" || (rtl ? a === "right" : a === "left");
}

/**
 * Widths (CSS px) of the spacers to put before and after a text run so that atoms emitted on their
 * own keep their room on the run's first and last line. `content` is the host's content box in
 * viewport coordinates (left/right only).
 */
export function runSpacers(
  cap: Capture,
  host: ElInfo,
  run: readonly FlatChild[],
  neighbours: RunNeighbours,
  content: { left: number; right: number },
): RunSpacers {
  const out: RunSpacers = { lead: 0, trail: 0 };
  const prev = inlineLevelAtom(cap, neighbours.prev);
  const next = inlineLevelAtom(cap, neighbours.next);
  if (!prev && !next) return out;
  const rtl = host.cs.direction === "rtl";
  const start = startAligned(host.cs, rtl);
  if (prev) {
    const first = firstFragment(cap, run);
    if (first && sameLine(rectOf(prev), first)) {
      const edges = marginEdges(prev);
      // Start-aligned lines begin at the content edge: everything before the text is reserved,
      // including earlier text on the same line. Otherwise only the atom's own footprint is.
      const lead = rtl
        ? (start ? content.right : edges.right) - first.right
        : first.left - (start ? content.left : edges.left);
      if (lead > 0.5) out.lead = Math.round(lead * 100) / 100;
    }
  }
  // A trailing atom only shifts start-aligned text when it wraps, so it matters for centred and
  // end-aligned lines only.
  if (next && !start) {
    const last = lastFragment(cap, run);
    if (last && sameLine(rectOf(next), last)) {
      const edges = marginEdges(next);
      const trail = (rtl ? last.left - edges.left : edges.right - last.right) - WRAP_SAFETY;
      if (trail > 0.5) out.trail = Math.round(trail * 100) / 100;
    }
  }
  return out;
}

/** Markup of an empty inline-block of the given width (no text, so typing skips it). */
export function spacerHtml(width: number): string {
  return `<span style="display:inline-block;width:${width}px"></span>`;
}
