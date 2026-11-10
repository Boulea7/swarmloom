/**
 * Box: crosshair drag from a corner with a live size badge and ghost placeholder, then the fill
 * fades in; corner radius and shadow arrive last.
 */

import type { BoxLayer, CSSMap, TaskGen } from "../../types";
import { layerRect, px } from "../geometry";
import { dragOutRect, revealOverGhost } from "../gestures";
import { easeInOut, easeOut, tween } from "../motion";
import { playPlacementNote } from "../notes";
import type { TaskBody, TaskScope } from "../scope";
import { BOX_DETAIL_MS, BOX_FILL_MS, BOX_HOLD_MS, pick, RELEASE_PAUSE_MS } from "../timing";

const ZERO_LENGTH = /^\s*0(?:\.0+)?(?:px)?\s*$/i;
const SIMPLE_PX = /^\s*(\d*\.?\d+)px\s*$/i;

/** Radius and shadow held back while the fill fades in, and how they come back. */
export interface BoxDetails {
  /** Transient styles applied during the fill. */
  hold: CSSMap;
  /** Final radius in px when it is a single px length (tweened), else null (switched). */
  radiusPx: number | null;
  radius: string | null;
  shadow: string | null;
}

export function boxDetails(style: CSSMap | undefined): BoxDetails | null {
  const radius = style?.["border-radius"]?.trim() || null;
  const shadow = style?.["box-shadow"]?.trim() || null;
  const hasRadius = radius !== null && !ZERO_LENGTH.test(radius);
  const hasShadow = shadow !== null && shadow.toLowerCase() !== "none";
  if (!hasRadius && !hasShadow) return null;
  const hold: CSSMap = {};
  if (hasRadius) hold["border-radius"] = "0px";
  if (hasShadow) hold["box-shadow"] = "none";
  const simple = hasRadius && radius ? SIMPLE_PX.exec(radius) : null;
  return {
    hold,
    radiusPx: simple ? Number(simple[1]) : null,
    radius: hasRadius ? radius : null,
    shadow: hasShadow ? shadow : null,
  };
}

/** Shadow switches on, radius grows to its value, then the transient styles are dropped. */
function* revealDetails(scope: TaskScope, details: BoxDetails): TaskGen {
  if (details.shadow) scope.style.set({ "box-shadow": details.shadow });
  const { radiusPx, radius } = details;
  if (radiusPx !== null) {
    yield* tween(
      scope.agent,
      pick(scope.agent.rng, BOX_DETAIL_MS),
      (t) => {
        scope.style.set({ "border-radius": px(radiusPx * t) });
      },
      easeOut,
    );
  } else {
    if (radius) scope.style.set({ "border-radius": radius });
    yield pick(scope.agent.rng, BOX_DETAIL_MS);
  }
  scope.style.clear();
}

export const boxTask: TaskBody<BoxLayer> = function* box(scope, layer) {
  const { agent, stage } = scope;
  const rect = layerRect(layer);
  if (!rect) {
    stage.reveal(layer.id, 1);
    return;
  }
  const placed = yield* dragOutRect(scope, rect, { ghost: true });
  yield pick(agent.rng, RELEASE_PAUSE_MS);

  playPlacementNote(scope, rect);
  const details = boxDetails(layer.style);
  if (details) scope.style.set(details.hold);
  yield* revealOverGhost(scope, layer.id, pick(agent.rng, BOX_FILL_MS), placed.ghost, easeInOut);
  if (details) yield* revealDetails(scope, details);

  yield pick(agent.rng, BOX_HOLD_MS);
  scope.drop(placed.selection);
};
