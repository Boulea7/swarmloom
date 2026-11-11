/**
 * Image: crosshair drag of a placeholder, then the picture is revealed. "sweep" (default) runs top
 * to bottom while the gray placeholder shrinks below the sweep line; "paint" brushes it in row by
 * row and "type" types it in line by line (both delegate the pattern to `stage.reveal`); "fade"
 * fades it in. A soft second note closes the placement.
 */

import type { ImageLayer, OverlayHandle, Rect, StageApi, TaskGen } from "../../types";
import { clampPoint, layerRect } from "../geometry";
import { dragOutRect } from "../gestures";
import { easeInOut, linear, offsets, runTimeline, track, tween } from "../motion";
import { playPlacementNote } from "../notes";
import type { TaskBody, TaskScope } from "../scope";
import {
  BOX_HOLD_MS,
  clamp,
  dragDuration,
  FADE_MS,
  IMAGE_TYPE_CHAR_W_PX,
  IMAGE_TYPE_MAX_UNITS,
  IMAGE_TYPE_SCALE,
  IMAGE_WAIT_FRAMES,
  imageTypeLines,
  MAX_SOUNDS_PER_BATCH,
  PAINT_ROW_PX,
  PAINT_ROWS_MAX,
  PAINT_ROWS_MIN,
  pick,
  RELEASE_PAUSE_MS,
  sweepDuration,
  VIEW_MARGIN_PX,
} from "../timing";
import { planTyping } from "../typing";

/**
 * Waits (a bounded number of frames) for the layer's <img> to finish loading, so the sweep does
 * not reveal an empty area. Exports never wait here: they await `Player.ready()` first, which
 * decodes every mounted image. A broken or slow image is revealed anyway after the bound.
 */
function* waitForImage(stage: StageApi, id: string): TaskGen {
  if (typeof HTMLImageElement === "undefined") return;
  const el = stage.el(id);
  const img = el instanceof HTMLImageElement ? el : (el?.querySelector("img") ?? null);
  if (!(img instanceof HTMLImageElement)) return;
  for (let frame = 0; frame < IMAGE_WAIT_FRAMES && !img.complete; frame++) yield undefined;
}

function* sweep(scope: TaskScope, id: string, rect: Rect, ghost: OverlayHandle | null): TaskGen {
  yield* tween(
    scope.agent,
    sweepDuration(rect.h),
    (t) => {
      scope.stage.reveal(id, t);
      ghost?.update({ x: rect.x, y: rect.y + rect.h * t, w: rect.w, h: rect.h * (1 - t), fill: true });
    },
    easeInOut,
  );
}

/** Zig-zag brush rows; reveal progress follows the brush. */
function* paint(scope: TaskScope, id: string, rect: Rect): TaskGen {
  const { agent, stage } = scope;
  const rows = clamp(Math.round(rect.h / PAINT_ROW_PX), PAINT_ROWS_MIN, PAINT_ROWS_MAX);
  const view = scope.viewport();
  const left = clampPoint({ x: rect.x + 6, y: rect.y }, view, VIEW_MARGIN_PX).x;
  const right = clampPoint({ x: rect.x + rect.w - 6, y: rect.y }, view, VIEW_MARGIN_PX).x;
  const rowY = (r: number): number =>
    clampPoint({ x: left, y: rect.y + (rect.h * (r + 0.5)) / rows }, view, VIEW_MARGIN_PX).y;
  scope.cursor("pen");
  yield* agent.moveTo(left, rowY(0));
  scope.press();
  for (let r = 0; r < rows; r++) {
    const fromX = r % 2 === 0 ? left : right;
    const toX = r % 2 === 0 ? right : left;
    const y = rowY(r);
    if (r > 0) yield* agent.dragTo(fromX, y, { dur: 90, ease: "inOut" });
    const span = Math.max(1, Math.abs(toX - fromX));
    yield* track(agent.dragTo(toX, y, { dur: dragDuration(span) * 0.8, ease: "inOut" }), () => {
      stage.reveal(id, (r + clamp(Math.abs(agent.x - fromX) / span, 0, 1)) / rows);
    });
  }
  scope.release();
}

/** Pseudo words for an image typed in: letters, a space every 3-8, a line break per row. */
function pseudoUnits(rect: Rect, lines: number, rng: () => number): { units: string[]; perLine: number } {
  const perLine = clamp(
    Math.round(rect.w / IMAGE_TYPE_CHAR_W_PX),
    4,
    Math.max(4, Math.floor(IMAGE_TYPE_MAX_UNITS / lines)),
  );
  const units: string[] = [];
  let word = 3 + Math.floor(rng() * 6);
  for (let i = 0; i < lines * perLine; i++) {
    if ((i + 1) % perLine === 0) units.push("\n");
    else if (--word <= 0) {
      units.push(" ");
      word = 3 + Math.floor(rng() * 6);
    } else units.push("a");
  }
  return { units, perLine };
}

function* typeIn(scope: TaskScope, id: string, rect: Rect, lines: number): TaskGen {
  const { agent, stage } = scope;
  const { units, perLine } = pseudoUnits(rect, lines, agent.rng);
  const strokes = planTyping(units, agent.rng, { scale: IMAGE_TYPE_SCALE });
  const lineH = rect.h / lines;
  const caretAt = (n: number) => ({
    x: rect.x + ((n % perLine) / perLine) * rect.w,
    y: rect.y + Math.min(lines - 1, Math.floor(n / perLine)) * lineH,
    h: lineH * 0.8,
  });
  scope.cursor("ibeam");
  const at = clampPoint({ x: rect.x + 6, y: rect.y + lineH / 2 }, scope.viewport(), VIEW_MARGIN_PX);
  yield* agent.moveTo(at.x, at.y);
  const caret = scope.overlay("caret", caretAt(0));
  yield* runTimeline(
    agent,
    offsets(strokes.map((s) => s.delay)),
    (i, batch) => {
      const stroke = strokes[i];
      if (stroke && batch < MAX_SOUNDS_PER_BATCH) agent.sound(stroke.sound, { vel: stroke.vel });
    },
    (last) => {
      const end = strokes[last]?.end ?? units.length;
      stage.reveal(id, end / units.length);
      caret.update(caretAt(end));
    },
  );
  scope.drop(caret);
}

export const imageTask: TaskBody<ImageLayer> = function* image(scope, layer) {
  const { agent, stage } = scope;
  const rect = layerRect(layer);
  if (!rect) {
    stage.reveal(layer.id, 1);
    return;
  }
  const mode = layer.reveal ?? "sweep";
  const placed = yield* dragOutRect(scope, rect, { ghost: true });
  yield pick(agent.rng, RELEASE_PAUSE_MS);
  yield* waitForImage(stage, layer.id);

  playPlacementNote(scope, rect);
  if (mode === "sweep") {
    yield* sweep(scope, layer.id, rect, placed.ghost);
  } else {
    // The placeholder would cover the other reveal patterns (overlays draw above content).
    scope.drop(placed.ghost);
    if (mode === "paint") yield* paint(scope, layer.id, rect);
    else if (mode === "type") yield* typeIn(scope, layer.id, rect, imageTypeLines(layer.lines, rect.h));
    else yield* tween(agent, pick(agent.rng, FADE_MS), (t) => stage.reveal(layer.id, t), linear);
  }
  stage.reveal(layer.id, 1);
  scope.drop(placed.ghost);
  playPlacementNote(scope, rect, { vel: 0.3, shift: 0.15 });
  yield pick(agent.rng, BOX_HOLD_MS);
  scope.drop(placed.selection);
};
