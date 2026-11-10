/**
 * Guide snapping: text that snaps to a guide is typed beside it, then dragged onto it. Inside the
 * snap radius the offset across the guide drops to zero at once (a magnet, no overshoot), the
 * guide tightens and a snap sounds.
 */

import type { GuideLayer, Point, Rect, Rng, StageApi, TaskGen, TextLayer } from "../../types";
import { clampPoint, guideLabel, offsetRect, translateValue } from "../geometry";
import { track } from "../motion";
import type { TaskScope } from "../scope";
import {
  PRESS_HOLD_MS,
  pick,
  SNAP_ACROSS_PX,
  SNAP_ALONG_PX,
  SNAP_DRAG_MS,
  SNAP_HOLD_MS,
  SNAP_RADIUS_PX,
  VIEW_MARGIN_PX,
} from "../timing";

/** First guide in `layer.snaps` that exists on the stage and has a usable position. */
export function findSnapGuide(stage: StageApi, layer: TextLayer): GuideLayer | null {
  for (const id of layer.snaps ?? []) {
    const guide = stage.layer(id);
    if (guide?.kind === "guide" && (guide.axis === "x" || guide.axis === "y") && Number.isFinite(guide.pos)) {
      return guide;
    }
  }
  return null;
}

function signed(rng: Rng, magnitude: number): number {
  return rng() < 0.5 ? -magnitude : magnitude;
}

/**
 * Where the text is typed relative to its final position: {@link SNAP_ACROSS_PX} across the
 * guide and {@link SNAP_ALONG_PX} along it, each on a random side.
 */
export function snapOffset(rng: Rng, axis: "x" | "y"): Point {
  const across = signed(rng, pick(rng, SNAP_ACROSS_PX));
  const along = signed(rng, pick(rng, SNAP_ALONG_PX));
  // A guide on axis "x" is a vertical line: across is horizontal.
  return axis === "x" ? { x: across, y: along } : { x: along, y: across };
}

/** Drags the text (typed at `rect` + `offset`) onto `guide`, ending exactly at `rect`. */
export function* snapToGuide(scope: TaskScope, rect: Rect, guide: GuideLayer, offset: Point, grabDy: number): TaskGen {
  const { agent } = scope;
  const vertical = guide.axis === "x";
  const view = scope.viewport();
  const label = guideLabel(guide.axis, guide.pos);
  const line = scope.overlay("guide", { axis: guide.axis, pos: guide.pos, label });
  const shifted = offsetRect(rect, offset.x, offset.y);
  const selection = scope.overlay("selection", { ...shifted, handles: true });
  const place = (dx: number, dy: number): void => {
    scope.style.set({ translate: translateValue(dx, dy) });
    selection.update({ ...offsetRect(rect, dx, dy), handles: true });
  };

  const grab = clampPoint(
    { x: shifted.x + Math.min(24, shifted.w * 0.3), y: shifted.y + grabDy },
    view,
    VIEW_MARGIN_PX,
  );
  scope.cursor("arrow");
  yield* agent.moveTo(grab.x, grab.y);
  scope.cursor("move");
  scope.press();
  yield pick(agent.rng, PRESS_HOLD_MS);

  // Cursor position once the text sits at its final position.
  const home = { x: grab.x - offset.x, y: grab.y - offset.y };
  const radius = pick(agent.rng, SNAP_RADIUS_PX);
  let snapped = false;
  const snap = (): void => {
    snapped = true;
    scope.sound("snap");
    line.update({ axis: guide.axis, pos: guide.pos, label, active: true });
  };
  yield* track(agent.dragTo(home.x, home.y, { dur: pick(agent.rng, SNAP_DRAG_MS), ease: "inOut" }), () => {
    let dx = agent.x - home.x;
    let dy = agent.y - home.y;
    const across = vertical ? dx : dy;
    if (!snapped && Math.abs(across) <= radius) snap();
    if (snapped) {
      if (vertical) dx = 0;
      else dy = 0;
    }
    place(dx, dy);
  });
  if (!snapped) snap();
  place(0, 0);
  scope.release();
  yield pick(agent.rng, SNAP_HOLD_MS);
  scope.drop(selection);
  scope.drop(line);
}
