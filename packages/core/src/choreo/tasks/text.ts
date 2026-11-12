/**
 * Text: click (short labels) or drag out a one-line text box, switch to the I-beam and type with a
 * caret at a natural, slightly irregular cadence. Headings are typed at a draft size and dragged
 * up to their final size; text that snaps is typed beside its guide (never over neighbouring
 * content) and dragged onto it.
 */

import type { Rect, TextLayer, Yield } from "../../types";
import { clampPoint, layerRect, offsetRect, px, translateValue } from "../geometry";
import { dragOutRect } from "../gestures";
import { click, easeInOut, tween } from "../motion";
import type { TaskBody, TaskScope } from "../scope";
import { type FontMetrics, scaleMetrics, textMetrics, typingUnits } from "../text-units";
import {
  FADE_MS,
  IBEAM_NUDGE_MS,
  IBEAM_PARK_PX,
  pick,
  TEXT_CLICK_MAX_VIEW_SHARE,
  TEXT_CLICK_MAX_WIDTH_PX,
  TYPE_END_MS,
  VIEW_MARGIN_PX,
} from "../timing";
import { growHeading, planHeadingGrowth, typeScale } from "./heading";
import { findSnapGuide, snapOffset, snapRoom, snapToGuide } from "./snap";
import { EditFrame, typeInto } from "./text-edit";

/** Lines a text box may have and still count as single-line (line boxes vary a little). */
const SINGLE_LINE_RATIO = 1.6;

/** True when a text box is entered with a click rather than dragged out. */
export function opensWithClick(rect: Rect, metrics: FontMetrics, view: Rect): boolean {
  const singleLine = rect.h <= metrics.lineHeight * SINGLE_LINE_RATIO;
  return singleLine && rect.w <= Math.min(TEXT_CLICK_MAX_WIDTH_PX, view.w * TEXT_CLICK_MAX_VIEW_SHARE);
}

/**
 * Opens a text box at `rect`: a short single-line text is clicked at its line start, anything
 * else is dragged out at its final width and one line high. Ends with the I-beam resting just left
 * of the first line, so neither it nor its name tag covers the text it types.
 */
function* openTextBox(scope: TaskScope, rect: Rect, metrics: FontMetrics): Generator<Yield, EditFrame, unknown> {
  const { agent } = scope;
  const view = scope.viewport();
  const lineBox: Rect = { ...rect, h: Math.min(rect.h, Math.max(metrics.lineHeight, 8)) };
  let frame: EditFrame;
  if (opensWithClick(rect, metrics, view)) {
    const at = clampPoint({ x: rect.x + 2, y: rect.y + lineBox.h / 2 }, view, VIEW_MARGIN_PX);
    scope.cursor("ibeam");
    yield* agent.moveTo(at.x, at.y);
    yield* click(scope);
    frame = new EditFrame(scope.overlay("selection", { ...lineBox, handles: false }), lineBox, rect);
  } else {
    const placed = yield* dragOutRect(scope, lineBox, { corner: "tl", handles: false });
    frame = new EditFrame(placed.selection, lineBox, rect);
  }
  scope.cursor("ibeam");
  const park = { x: rect.x - IBEAM_PARK_PX - agent.rng() * 4, y: rect.y + lineBox.h * 0.55 };
  const nudge = clampPoint(park, view, VIEW_MARGIN_PX);
  yield* agent.moveTo(nudge.x, nudge.y, { dur: pick(agent.rng, IBEAM_NUDGE_MS), ease: "out" });
  return frame;
}

/** Task body of text layers. */
export const textTask: TaskBody<TextLayer> = function* text(scope, layer) {
  const { agent, stage } = scope;
  const rect = layerRect(layer);
  const mode = layer.reveal ?? "type";
  if (!rect || mode === "none") {
    stage.reveal(layer.id, 1);
    return;
  }
  const units = typingUnits(typeof layer.text === "string" ? layer.text : "");
  const metrics = textMetrics(layer);
  const guide = findSnapGuide(stage, layer);
  const offset = guide ? snapOffset(agent.rng, guide.axis, snapRoom(stage, layer, rect, guide.axis)) : { x: 0, y: 0 };
  const growth =
    mode === "type"
      ? planHeadingGrowth(layer, metrics, rect, units.length, scope.viewport(), typeScale(stage.blueprint), agent.rng)
      : null;
  if (guide) scope.style.set({ translate: translateValue(offset.x, offset.y) });
  if (growth) scope.style.set({ "font-size": px(growth.draft) });
  const typing = growth ? scaleMetrics(metrics, growth.draft) : metrics;
  const shifted = offsetRect(rect, offset.x, offset.y);

  const frame = yield* openTextBox(scope, shifted, typing);
  if (mode === "type" && units.length > 0) {
    yield* typeInto(scope, layer.id, units, typing, frame);
  } else if (mode === "fade") {
    const opacity = layer.opacity ?? 1;
    scope.style.set({ opacity: "0" });
    stage.reveal(layer.id, 1);
    yield* tween(agent, pick(agent.rng, FADE_MS), (t) => scope.style.set({ opacity: String(t * opacity) }), easeInOut);
  } else {
    // "stamp" (and empty text): appears in one go.
    stage.reveal(layer.id, 1);
    if (units.length > 0) scope.sound("pop");
    yield pick(agent.rng, TYPE_END_MS);
  }
  if (growth) yield* growHeading(scope, layer.id, growth, metrics, units.length, frame, shifted);
  scope.drop(frame.overlay);
  if (guide) yield* snapToGuide(scope, rect, guide, offset, Math.min(rect.h / 2, metrics.lineHeight / 2));
  stage.reveal(layer.id, 1);
};
