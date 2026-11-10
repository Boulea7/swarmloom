import { type Capture, infoOf } from "./state";

/** Ascent / (ascent + descent) of a font, measured once per font with a canvas. */
function ascentRatio(cap: Capture, cs: CSSStyleDeclaration): number {
  const key = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
  const cached = cap.fontRatios.get(key);
  if (cached !== undefined) return cached;
  let ratio = 0.8;
  if (cap.measure === undefined) {
    try {
      cap.measure = cap.doc.createElement("canvas").getContext("2d");
    } catch {
      cap.measure = null;
    }
  }
  const m = cap.measure;
  if (m) {
    m.font = key;
    const metrics = m.measureText("Hg");
    const a = metrics.fontBoundingBoxAscent;
    const d = metrics.fontBoundingBoxDescent;
    if (Number.isFinite(a) && Number.isFinite(d) && a + d > 0) ratio = a / (a + d);
  }
  cap.fontRatios.set(key, ratio);
  return ratio;
}

/** Viewport rect of the first visible character of a text node. */
function firstCharRect(cap: Capture, node: Text): DOMRect | null {
  const i = node.data.search(/\S/);
  if (i < 0) return null;
  const range = cap.range;
  range.setStart(node, i);
  range.setEnd(node, Math.min(node.data.length, i + 1));
  const r = range.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? r : null;
}

/** Geometry of the first line of a text block, in viewport coordinates. */
export interface FirstLine {
  /** First baseline, viewport y. */
  baseline: number;
  /** Content-area height of the first glyph (used to derive half-leading). */
  contentHeight: number;
  top: number;
}

/** Baseline and glyph box of the line that holds the first visible character of `node`. */
export function firstLineOf(cap: Capture, node: Text | null): FirstLine | null {
  if (!node) return null;
  const r = firstCharRect(cap, node);
  if (!r) return null;
  const parent = node.parentElement;
  const ratio = parent ? ascentRatio(cap, infoOf(cap, parent).cs) : 0.8;
  return { baseline: r.top + r.height * ratio, contentHeight: r.height, top: r.top };
}
