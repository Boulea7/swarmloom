import type { Rect, Size } from "@swarmloom/core";
import { parseNumberList } from "./path/parse";

export const SVG_NS = "http://www.w3.org/2000/svg";
export const XLINK_NS = "http://www.w3.org/1999/xlink";

/** CSS absolute units in px. Font-relative units assume the 16px default. */
const UNIT_PX: Record<string, number> = {
  "": 1,
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  em: 16,
  rem: 16,
  ex: 8,
};

const LENGTH_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/;

/**
 * Parses an SVG/CSS length to px. Percentages resolve against `percentBase` when given, otherwise
 * the result is null (unknown). Unknown units and keywords such as "auto" give null.
 */
export function parseLength(value: string | null | undefined, percentBase?: number): number | null {
  if (value == null) return null;
  const m = LENGTH_RE.exec(value);
  if (!m) return null;
  const num = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "%") return percentBase === undefined ? null : (num * percentBase) / 100;
  const k = UNIT_PX[unit];
  return k === undefined ? null : num * k;
}

/** Parses a `viewBox`; null when missing or invalid (non-positive size disables the viewBox). */
export function parseViewBox(value: string | null | undefined): Rect | null {
  if (!value) return null;
  const n = parseNumberList(value);
  if (n.length !== 4) return null;
  const [x = 0, y = 0, w = 0, h = 0] = n;
  if (!(w > 0 && h > 0)) return null;
  return { x, y, w, h };
}

/**
 * Intrinsic size of a root `<svg>` in px from its width/height attributes and viewBox
 * (percentages count as unspecified). Null when nothing determines a size.
 */
export function intrinsicSize(width: string | null, height: string | null, viewBox: Rect | null): Size | null {
  const w = parseLength(width);
  const h = parseLength(height);
  const wOk = w !== null && w > 0;
  const hOk = h !== null && h > 0;
  if (wOk && hOk) return { w, h };
  if (viewBox) {
    const ratio = viewBox.h / viewBox.w;
    if (wOk) return { w, h: w * ratio };
    if (hOk) return { w: h / ratio, h };
    return { w: viewBox.w, h: viewBox.h };
  }
  return null;
}

/** Height of the frame a drawing is fitted into, per px of layout width (16:9, the CLI's default viewport). */
const FRAME_RATIO = 9 / 16;
/** Tallest stage size the adapter produces, px. */
const MAX_STAGE_HEIGHT = 60_000;

/**
 * Stage size of a drawing laid out `width` px wide. It fills the width unless that makes it taller
 * than a 16:9 frame; then it is fitted whole into the frame, so a logo or a square chart ends fully
 * in view (the stage enlarges it into a taller viewport). Drawings that would end up narrower than
 * half the width that way (long diagrams) keep the full width and scroll instead.
 *
 * @param fit "frame" (default) as above; "width" always fills the width.
 */
export function stageSize(intrinsic: Size, width: number, fit: "frame" | "width" = "frame"): Size {
  let scale = width / intrinsic.w;
  const framed = (width * FRAME_RATIO) / intrinsic.h;
  if (fit === "frame" && framed < scale && framed >= scale / 2) scale = framed;
  if (intrinsic.h * scale > MAX_STAGE_HEIGHT) scale = MAX_STAGE_HEIGHT / intrinsic.h;
  return { w: Math.max(1, Math.round(intrinsic.w * scale)), h: Math.max(1, Math.round(intrinsic.h * scale)) };
}

/** Normalised diagonal used to resolve percentages that are neither horizontal nor vertical. */
export function normalizedDiagonal(size: Size): number {
  return Math.sqrt((size.w * size.w + size.h * size.h) / 2);
}
