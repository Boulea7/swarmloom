/**
 * Duration estimates of the built-in choreographies at speed 1, from the same constants the tasks
 * use (range midpoints, travel approximated). Pure and deterministic: the planner calls it for the
 * ETA and the tour pace, possibly for thousands of layers, so it never touches the DOM.
 */

import type { ImageLayer, Layer, PathLayer, TextLayer } from "../types";
import { layerRect } from "./geometry";
import { parsePathAnchors, pathMode } from "./path-data";
import { textMetrics } from "./text-units";
import {
  AUTOCOMPLETE_MS,
  BOX_DETAIL_MS,
  BOX_FILL_MS,
  BOX_HOLD_MS,
  CLICK_HOLD_MS,
  clamp,
  DUP_BEAT_MS,
  DUP_DOUBLE_CLICK_GAP_MS,
  DUP_DRAG_ESTIMATE_PX,
  DUP_EDIT_LIKELIHOOD,
  DUP_HIGHLIGHT_MS,
  DUP_RESTYLE_MS,
  DUP_RETYPE_MAX_MS,
  DUP_RETYPE_SCALE,
  DUP_SELECT_HOLD_MS,
  DUP_SETTLE_MS,
  DUP_SWAP_MS,
  dragDuration,
  FADE_MS,
  FILL_FADE_MS,
  GUIDE_DRAG_MS,
  GUIDE_GRAB_MS,
  GUIDE_HOLD_MS,
  HEADING_MAX_GRAPHEMES,
  HEADING_MAX_LINES,
  HEADING_MAX_STEPS,
  HEADING_MIN_PX,
  HEADING_MIN_STEPS,
  HEADING_STEP_MS,
  IBEAM_NUDGE_MS,
  IMAGE_TYPE_CHAR_W_PX,
  IMAGE_TYPE_LINE_H_PX,
  IMAGE_TYPE_MAX_UNITS,
  IMAGE_TYPE_SCALE,
  MAX_ESTIMATE_MS,
  MEDIA_FADE_MS,
  MIN_ESTIMATE_MS,
  mid,
  PAINT_ROW_PX,
  PAINT_ROWS_MAX,
  PAINT_ROWS_MIN,
  PEN_CLICK_MS,
  PEN_LIFT_MS,
  PEN_MAX_ANCHORS,
  PRESS_HOLD_MS,
  penMoveDuration,
  RELEASE_PAUSE_MS,
  SNAP_DRAG_MS,
  SNAP_HOLD_MS,
  sweepDuration,
  TEXT_CLICK_MAX_WIDTH_PX,
  TRAVEL_ESTIMATE_MS,
  TYPE_END_MS,
  TYPE_START_MS,
  traceDuration,
} from "./timing";
import { typingBudget } from "./typing";

/** Graphemes are approximated by code points here: estimates must stay cheap. */
function approxLength(text: unknown): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  let n = 0;
  for (const _ of text) n++;
  return n;
}

const CLICK = mid(CLICK_HOLD_MS);
const PLACE_TAIL = mid(RELEASE_PAUSE_MS) + mid(BOX_HOLD_MS);

function dragRect(w: number, h: number): number {
  return TRAVEL_ESTIMATE_MS + mid(PRESS_HOLD_MS) + dragDuration(Math.hypot(w, h));
}

function estimateBox(layer: Layer, w: number, h: number): number {
  const style = "style" in layer ? layer.style : undefined;
  const details = style?.["border-radius"] || style?.["box-shadow"] ? mid(BOX_DETAIL_MS) : 0;
  return dragRect(w, h) + PLACE_TAIL + mid(BOX_FILL_MS) + details;
}

function estimateText(layer: TextLayer, w: number, h: number): number {
  const count = approxLength(layer.text);
  const metrics = textMetrics(layer);
  const singleLine = h <= metrics.lineHeight * 1.6;
  const open =
    singleLine && w <= TEXT_CLICK_MAX_WIDTH_PX
      ? TRAVEL_ESTIMATE_MS + CLICK
      : dragRect(w, Math.min(h, metrics.lineHeight));
  let total = open + mid(IBEAM_NUDGE_MS);
  const mode = layer.reveal ?? "type";
  if (mode === "type") total += mid(TYPE_START_MS) + typingBudget(count) + mid(TYPE_END_MS);
  else total += mid(FADE_MS);
  // The document's type scale is not known here; the role or the absolute size decides.
  const grows =
    mode === "type" &&
    (layer.role === "heading" || metrics.fontSize >= HEADING_MIN_PX) &&
    count > 0 &&
    count <= HEADING_MAX_GRAPHEMES &&
    h <= metrics.lineHeight * HEADING_MAX_LINES;
  if (grows) {
    const steps = (HEADING_MIN_STEPS + HEADING_MAX_STEPS) / 2;
    total += TRAVEL_ESTIMATE_MS / 2 + mid(PRESS_HOLD_MS) + steps * mid(HEADING_STEP_MS);
  }
  if (layer.snaps && layer.snaps.length > 0) {
    total += TRAVEL_ESTIMATE_MS + mid(PRESS_HOLD_MS) + mid(SNAP_DRAG_MS) + mid(SNAP_HOLD_MS);
  }
  return total;
}

function estimatePath(layer: PathLayer): number {
  // Only the first anchors matter for pacing; cap parsing so huge paths stay cheap.
  const path = parsePathAnchors(layer.d, PEN_MAX_ANCHORS * 4);
  if (path.count === 0) return TRAVEL_ESTIMATE_MS + CLICK + mid(FADE_MS);
  const fill = layer.fill && layer.fill !== "none" ? mid(FILL_FADE_MS) : 0;
  const mode = pathMode(layer.reveal, path);
  if (mode === "fade") return TRAVEL_ESTIMATE_MS + CLICK + mid(FADE_MS);
  if (mode === "trace") return TRAVEL_ESTIMATE_MS + traceDuration(path.length) + fill;
  const hops = Math.max(0, path.count - 1);
  const hop = hops > 0 ? penMoveDuration(path.length / hops) : 0;
  return (
    TRAVEL_ESTIMATE_MS +
    path.count * mid(PEN_CLICK_MS) +
    hops * hop +
    mid(PEN_LIFT_MS) +
    traceDuration(path.length) +
    fill
  );
}

function estimateImage(layer: ImageLayer, w: number, h: number): number {
  const base = dragRect(w, h) + PLACE_TAIL + mid(AUTOCOMPLETE_MS) * 0.25;
  switch (layer.reveal ?? "sweep") {
    case "paint": {
      const rows = clamp(Math.round(h / PAINT_ROW_PX), PAINT_ROWS_MIN, PAINT_ROWS_MAX);
      return base + TRAVEL_ESTIMATE_MS + rows * (dragDuration(w) * 0.8 + 90);
    }
    case "type": {
      const lines = clamp(Math.round(h / IMAGE_TYPE_LINE_H_PX), 1, 40);
      const perLine = clamp(
        Math.round(w / IMAGE_TYPE_CHAR_W_PX),
        4,
        Math.max(4, Math.floor(IMAGE_TYPE_MAX_UNITS / lines)),
      );
      return base + TRAVEL_ESTIMATE_MS + typingBudget(lines * perLine, { scale: IMAGE_TYPE_SCALE });
    }
    case "fade":
      return base + mid(FADE_MS);
    default:
      return base + sweepDuration(h);
  }
}

function estimateDuplicate(layer: Layer): number {
  let total =
    TRAVEL_ESTIMATE_MS +
    CLICK +
    mid(DUP_SELECT_HOLD_MS) +
    mid(DUP_BEAT_MS) +
    mid(PRESS_HOLD_MS) +
    dragDuration(DUP_DRAG_ESTIMATE_PX) +
    mid(DUP_SETTLE_MS);
  let edit = TRAVEL_ESTIMATE_MS + CLICK + (layer.kind === "image" ? mid(DUP_SWAP_MS) : mid(DUP_RESTYLE_MS));
  if (layer.kind === "text") {
    const count = approxLength(layer.text);
    edit =
      TRAVEL_ESTIMATE_MS +
      2 * CLICK +
      mid(DUP_DOUBLE_CLICK_GAP_MS) +
      mid(DUP_HIGHLIGHT_MS) +
      mid(TYPE_START_MS) +
      typingBudget(count, { scale: DUP_RETYPE_SCALE, maxMs: DUP_RETYPE_MAX_MS }) +
      mid(TYPE_END_MS);
  }
  total += edit * DUP_EDIT_LIKELIHOOD;
  return total;
}

function estimateGuide(): number {
  return TRAVEL_ESTIMATE_MS + mid(GUIDE_GRAB_MS) + mid(GUIDE_DRAG_MS) + mid(GUIDE_HOLD_MS);
}

/**
 * Estimated duration of the built-in task for `layer` at speed 1, in engine ms, including the
 * cursor's travel to the work. Always within [MIN_ESTIMATE_MS, MAX_ESTIMATE_MS].
 */
export function estimate(layer: Layer): number {
  if (!layer || typeof layer !== "object") return MIN_ESTIMATE_MS;
  let ms: number;
  if (layer.kind === "guide") ms = estimateGuide();
  else if (layer.kind === "path" && layer.master === undefined) ms = estimatePath(layer);
  else {
    // Zero-size or fully clipped layers are revealed without a gesture.
    const rect = layerRect(layer);
    if (!rect) return MIN_ESTIMATE_MS;
    const { w, h } = rect;
    if (layer.master !== undefined) ms = estimateDuplicate(layer);
    else if (layer.kind === "box") ms = estimateBox(layer, w, h);
    else if (layer.kind === "text") ms = estimateText(layer, w, h);
    else if (layer.kind === "image") ms = estimateImage(layer, w, h);
    else if (layer.kind === "media") ms = dragRect(w, h) + PLACE_TAIL + mid(MEDIA_FADE_MS);
    else ms = TRAVEL_ESTIMATE_MS + CLICK + mid(FADE_MS);
  }
  return clamp(Number.isFinite(ms) ? ms : MIN_ESTIMATE_MS, MIN_ESTIMATE_MS, MAX_ESTIMATE_MS);
}
