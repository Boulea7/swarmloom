/**
 * Generic fades. `fadeIn`: the cursor clicks the layer and its reveal runs 0 -> 1 (fallback for any
 * kind). `reducedTask`: a short cross-fade without cursor or overlays, for reduced motion.
 */

import type { Layer, TaskGen } from "../../types";
import { center, clampPoint, layerRect } from "../geometry";
import { click, easeInOut, tween } from "../motion";
import type { TaskBody, TaskScope } from "../scope";
import { FADE_MS, pick, REDUCED_FADE_MS, VIEW_MARGIN_PX } from "../timing";

/** Moves to the layer, clicks it and fades its reveal in. */
export function* fadeIn(scope: TaskScope, layer: Layer): TaskGen {
  const { agent, stage } = scope;
  const rect = layerRect(layer);
  if (rect) {
    const at = clampPoint(center(rect), scope.viewport(), VIEW_MARGIN_PX);
    yield* agent.moveTo(at.x, at.y);
    yield* click(scope);
  }
  yield* tween(agent, pick(agent.rng, FADE_MS), (t) => stage.reveal(layer.id, t), easeInOut);
}

/** Task body of the "fade" key. */
export const fadeTask: TaskBody<Layer> = fadeIn;

/** Task body of the "reduced" key: the cursor stays put, the layer cross-fades in. */
export const reducedTask: TaskBody<Layer> = function* reduced(scope, layer) {
  const { agent, stage } = scope;
  yield* tween(agent, pick(agent.rng, REDUCED_FADE_MS), (t) => stage.reveal(layer.id, t), easeInOut);
};
