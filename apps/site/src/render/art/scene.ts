/**
 * Tiny declarative "build scene" engine for the animated SVG placeholders.
 *
 * A scene is a set of pieces (bars, boxes, strokes, dots). Each piece is built by one of up to
 * three cursors in one of four task slots. Timing is fixed by a shared CSS keyframe schedule
 * (styles/scenes.css); this module only computes positions and per-piece delays, so a scene is
 * plain markup with CSS custom properties and costs no JavaScript to animate.
 *
 * Without animation (no JS, reduced motion) every piece renders in its final state and the
 * cursors rest at their park positions.
 */

import { cssVars, esc, num } from "../html";
import { cursorGlyph } from "./cursor";
import { cursorColor } from "./palette";

/** Scene loop length in seconds; must match `--scene-cycle` in styles/scenes.css. */
export const SCENE_CYCLE = 10;
/** Start of each task slot as a fraction of the cycle; must match the `sl-cur` keyframes. */
export const SLOT_START = [0.06, 0.145, 0.23, 0.315] as const;
/** Length of one task as a fraction of the cycle. */
export const SLOT_LENGTH = 0.045;
/** Phase offset between consecutive cursors as a fraction of the cycle. */
export const CURSOR_LAG = 0.03;

/** gx: grow right; gy: grow down; rise: grow up; type: stepped grow right; draw: stroke; pop/fade: appear. */
export type Reveal = "gx" | "gy" | "rise" | "fade" | "draw" | "type" | "pop";

/** Colour role of a piece. `c<n>` uses cursor palette colour n. */
export type Tone =
  | "ink1"
  | "ink2"
  | "ink3"
  | "line"
  | "acc"
  | "well"
  | "sheet"
  | "ide"
  | "ide2"
  | "idefg"
  | `c${number}`;

export interface Point {
  x: number;
  y: number;
}

/** Which cursor builds a piece, in which slot, with an optional extra delay in seconds. */
export interface Task {
  cursor: 0 | 1 | 2;
  slot: 0 | 1 | 2 | 3;
  lag?: number;
}

interface PieceBase {
  tone: Tone;
  /** Omit for static frame pieces that never animate. */
  task?: Task;
  reveal?: Reveal;
  opacity?: number;
}

export interface RectPiece extends PieceBase {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  /** Outline instead of fill. */
  outline?: boolean;
}

export interface LinePiece extends PieceBase {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width?: number;
}

export interface PathPiece extends PieceBase {
  kind: "path";
  d: string;
  /** Where the cursor starts and ends while drawing the path. */
  from: Point;
  to: Point;
  fill?: boolean;
  width?: number;
}

export interface CirclePiece extends PieceBase {
  kind: "circle";
  cx: number;
  cy: number;
  r: number;
  outline?: boolean;
}

export type Piece = RectPiece | LinePiece | PathPiece | CirclePiece;

export interface SceneCursor {
  /** Index into the brand cursor palette. */
  color: number;
  name?: string;
  enter: Point;
  park: Point;
}

export interface SceneSpec {
  w: number;
  h: number;
  /** Static pieces drawn under the animated content (sheets, frames). */
  frame?: Piece[];
  pieces: Piece[];
  cursors: SceneCursor[];
  /** Cursor glyph scale; 1 = 24 user units. */
  cursorScale?: number;
  /** Draw name tags next to cursors. */
  tags?: boolean;
  /** Accessible label; omit for decorative scenes (rendered aria-hidden). */
  label?: string;
  className?: string;
  /** Position as a nested <svg> inside a parent drawing (device screens). */
  place?: { x: number; y: number; w: number; h: number; clip?: string };
}

/** Default reveal per piece kind. */
function revealOf(piece: Piece): Reveal {
  if (piece.reveal) return piece.reveal;
  if (piece.kind === "line" || (piece.kind === "path" && !piece.fill)) return "draw";
  if (piece.kind === "circle") return "pop";
  return "gx";
}

/** Start and end of the cursor's gesture while building a piece. */
export function gestureOf(piece: Piece): [Point, Point] {
  switch (piece.kind) {
    case "rect": {
      const reveal = revealOf(piece);
      if (reveal === "gy") {
        return [
          { x: piece.x + piece.w * 0.5, y: piece.y },
          { x: piece.x + piece.w * 0.5, y: piece.y + piece.h },
        ];
      }
      if (reveal === "rise") {
        return [
          { x: piece.x + piece.w * 0.5, y: piece.y + piece.h },
          { x: piece.x + piece.w * 0.5, y: piece.y },
        ];
      }
      if (reveal === "fade" || reveal === "pop") {
        return [
          { x: piece.x, y: piece.y },
          { x: piece.x + piece.w, y: piece.y + piece.h },
        ];
      }
      const midY = piece.y + piece.h * 0.5;
      return [
        { x: piece.x, y: midY },
        { x: piece.x + piece.w, y: midY },
      ];
    }
    case "line":
      return [
        { x: piece.x1, y: piece.y1 },
        { x: piece.x2, y: piece.y2 },
      ];
    case "path":
      return [piece.from, piece.to];
    case "circle":
      return [
        { x: piece.cx - piece.r * 0.7, y: piece.cy - piece.r * 0.7 },
        { x: piece.cx + piece.r * 0.5, y: piece.cy + piece.r * 0.5 },
      ];
  }
}

/**
 * Largest offset (seconds) of a piece after its slot start. The per-slot visibility windows in
 * styles/scenes.css assume every piece of a slot starts within this span; see `sl-win*`.
 */
export const MAX_SLOT_OFFSET = 0.9;

/** Delay in seconds before a piece starts revealing (slot start + cursor lag + extra lag, clamped). */
export function pieceDelay(task: Task): number {
  const offset = Math.min(task.cursor * CURSOR_LAG * SCENE_CYCLE + Math.max(0, task.lag ?? 0), MAX_SLOT_OFFSET);
  return SLOT_START[task.slot] * SCENE_CYCLE + offset;
}

function toneAttrs(piece: Piece, filled: boolean): string {
  return filled ? `class="tf-${piece.tone}"` : `class="ts-${piece.tone}"`;
}

function pieceMarkup(piece: Piece): string {
  const animated = piece.task !== undefined;
  const reveal = revealOf(piece);
  const classes = animated ? `pc pc-${reveal} s${(piece.task as Task).slot}` : "";
  const style = animated ? ` style="--d:${num(pieceDelay(piece.task as Task))}s"` : "";
  // Tone opacity goes through fill/stroke-opacity so CSS reveal animations can own `opacity`.
  const filled = piece.kind === "line" ? false : piece.kind === "path" ? Boolean(piece.fill) : !piece.outline;
  const opacity =
    piece.opacity === undefined ? "" : ` ${filled ? "fill-opacity" : "stroke-opacity"}="${num(piece.opacity)}"`;
  const wrap = (inner: string) => (classes ? `<g class="${classes}"${style}>${inner}</g>` : inner);
  const draws = reveal === "draw" && animated ? ' pathLength="1"' : "";
  switch (piece.kind) {
    case "rect": {
      const r = piece.r ?? Math.min(piece.h / 2, 4);
      const geometry = `x="${num(piece.x)}" y="${num(piece.y)}" width="${num(piece.w)}" height="${num(piece.h)}" rx="${num(r)}"`;
      return wrap(`<rect ${geometry} ${toneAttrs(piece, !piece.outline)}${opacity}${draws}/>`);
    }
    case "line": {
      const width = piece.width ?? 2;
      return wrap(
        `<line x1="${num(piece.x1)}" y1="${num(piece.y1)}" x2="${num(piece.x2)}" y2="${num(piece.y2)}" stroke-width="${num(width)}" ${toneAttrs(piece, false)}${opacity}${draws}/>`,
      );
    }
    case "path": {
      const width = piece.width === undefined ? "" : ` stroke-width="${num(piece.width)}"`;
      return wrap(`<path d="${esc(piece.d)}" ${toneAttrs(piece, Boolean(piece.fill))}${width}${opacity}${draws}/>`);
    }
    case "circle":
      return wrap(
        `<circle cx="${num(piece.cx)}" cy="${num(piece.cy)}" r="${num(piece.r)}" ${toneAttrs(piece, !piece.outline)}${opacity}${draws}/>`,
      );
  }
}

/** CSS custom properties that drive one cursor through the shared keyframe schedule. */
export function cursorVars(cursor: SceneCursor, index: number, pieces: readonly Piece[]): Record<string, string> {
  const px = (value: number) => `${num(value)}px`;
  const vars: Record<string, string> = { x0: px(cursor.enter.x), y0: px(cursor.enter.y) };
  let last = cursor.enter;
  for (let slot = 0; slot < SLOT_START.length; slot++) {
    const own = pieces
      .filter((p) => p.task?.cursor === index && p.task.slot === slot)
      .sort((a, b) => (a.task?.lag ?? 0) - (b.task?.lag ?? 0));
    const first = own[0];
    const lastPiece = own[own.length - 1];
    const start = first ? gestureOf(first)[0] : last;
    const end = lastPiece ? gestureOf(lastPiece)[1] : start;
    vars[`sx${slot}`] = px(start.x);
    vars[`sy${slot}`] = px(start.y);
    vars[`ex${slot}`] = px(end.x);
    vars[`ey${slot}`] = px(end.y);
    last = end;
  }
  vars.px = px(cursor.park.x);
  vars.py = px(cursor.park.y);
  vars.cd = `${num(index * CURSOR_LAG * SCENE_CYCLE)}s`;
  return vars;
}

/** Renders a scene as an inline SVG string. */
export function renderScene(spec: SceneSpec): string {
  const { w, h } = spec;
  for (const piece of spec.pieces) {
    if (piece.task && piece.task.cursor >= spec.cursors.length) {
      throw new Error(`Scene piece assigned to missing cursor ${piece.task.cursor}`);
    }
  }
  const a11y = spec.label ? `role="img" aria-label="${esc(spec.label)}"` : 'aria-hidden="true" focusable="false"';
  const frame = (spec.frame ?? []).map(pieceMarkup).join("");
  const pieces = spec.pieces.map(pieceMarkup).join("");
  const scale = spec.cursorScale ?? 1;
  const cursors = spec.cursors
    .map((cursor, index) => {
      const vars = cssVars(cursorVars(cursor, index, spec.pieces));
      const glyph = cursorGlyph(cursorColor(cursor.color), spec.tags ? cursor.name : undefined, scale);
      return `<g class="sc-cur" style="${vars}">${glyph}</g>`;
    })
    .join("");
  const cls = ["scene", spec.className].filter(Boolean).join(" ");
  const place = spec.place
    ? ` x="${num(spec.place.x)}" y="${num(spec.place.y)}" width="${num(spec.place.w)}" height="${num(spec.place.h)}"`
    : "";
  const svg =
    `<svg class="${cls}" viewBox="0 0 ${num(w)} ${num(h)}"${place} ${a11y} data-scene>` +
    frame +
    `<g class="sc-root">${pieces}${cursors}</g></svg>`;
  // A clip-path on a nested <svg> resolves in the nested viewport's coordinates in Chromium, which
  // shifts the clip by the placement offset. A wrapping group keeps the clip in the parent's space.
  return spec.place?.clip ? `<g clip-path="url(#${spec.place.clip})">${svg}</g>` : svg;
}
