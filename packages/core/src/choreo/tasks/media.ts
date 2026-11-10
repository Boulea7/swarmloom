/**
 * Media (video, iframe, canvas, embed): drag a placeholder rect, then the placeholder (or its
 * snapshot) fades in under a label pill naming what it stands for.
 */

import type { MediaLayer } from "../../types";
import { layerRect } from "../geometry";
import { dragOutRect, revealOverGhost } from "../gestures";
import { easeInOut } from "../motion";
import { playPlacementNote } from "../notes";
import type { TaskBody } from "../scope";
import { BOX_HOLD_MS, MEDIA_FADE_MS, MEDIA_LABEL_MAX_CHARS, pick, RELEASE_PAUSE_MS } from "../timing";

/** Media notes sit a little under boxes: placeholders are not the finished content. */
const MEDIA_NOTE_VEL = 0.5;
/** Pitch offset of the second media note (roughly a third or fifth on the sound's scale). */
const MEDIA_SECOND_SHIFT = 0.15;
/** Label pill inset from the placeholder's top-left corner. */
const LABEL_INSET_PX = 8;

/** Placeholder label: whitespace collapsed, ellipsized after {@link MEDIA_LABEL_MAX_CHARS} characters. */
export function mediaLabel(label: unknown): string {
  const text = typeof label === "string" ? label.replace(/\s+/g, " ").trim() : "";
  const chars = Array.from(text);
  return chars.length > MEDIA_LABEL_MAX_CHARS ? `${chars.slice(0, MEDIA_LABEL_MAX_CHARS - 1).join("")}…` : text;
}

/** Task body of media layers. */
export const mediaTask: TaskBody<MediaLayer> = function* media(scope, layer) {
  const { agent, stage } = scope;
  const rect = layerRect(layer);
  if (!rect) {
    stage.reveal(layer.id, 1);
    return;
  }
  const placed = yield* dragOutRect(scope, rect, { ghost: true, keepBadge: true });
  const label = mediaLabel(layer.label);
  if (label) placed.badge?.update({ x: rect.x + LABEL_INSET_PX, y: rect.y + LABEL_INSET_PX, text: label });
  else scope.drop(placed.badge);
  yield pick(agent.rng, RELEASE_PAUSE_MS);

  playPlacementNote(scope, rect, { vel: MEDIA_NOTE_VEL });
  // Media placements sound as a pair: the placement note and a softer consonant one above it.
  playPlacementNote(scope, rect, { vel: MEDIA_NOTE_VEL * 0.6, shift: MEDIA_SECOND_SHIFT });
  yield* revealOverGhost(scope, layer.id, pick(agent.rng, MEDIA_FADE_MS), placed.ghost, easeInOut);
  yield pick(agent.rng, BOX_HOLD_MS);
  scope.drop(placed.badge);
  scope.drop(placed.selection);
};
