/**
 * Guide: the cursor grabs the ruler at the viewport edge (top ruler for a horizontal guide, left
 * ruler for a vertical one), drags the guide line out with a live position label and drops it at
 * `pos` with a snap.
 */

import type { GuideLayer, Point, Rect } from "../../types";
import { center, clampPoint, guideLabel, isFinitePoint } from "../geometry";
import { track } from "../motion";
import type { TaskBody } from "../scope";
import {
  clamp,
  GUIDE_DRAG_MS,
  GUIDE_GRAB_MS,
  GUIDE_GRAB_SPREAD_PX,
  GUIDE_HOLD_MS,
  pick,
  RULER_INSET_PX,
  VIEW_MARGIN_PX,
} from "../timing";

/** Guides are the thinnest placements: a soft, high note. */
const GUIDE_NOTE_VEL = 0.32;

/**
 * Where the cursor grabs the ruler for a guide. Axis "x" is a vertical line at x = pos (pulled
 * from the left ruler), axis "y" a horizontal line at y = pos (pulled from the top ruler). The
 * grab point sits on the ruler, a little before or after the guide's own span so cursors spread out.
 */
export function rulerGrabPoint(guide: GuideLayer, view: Rect, rng: () => number): Point {
  const spread = pick(rng, GUIDE_GRAB_SPREAD_PX) * (rng() < 0.5 ? -1 : 1);
  // Guide boxes are often zero-width lines; only their extent along the line matters here.
  const span =
    guide.box && isFinitePoint(guide.box)
      ? center({ ...guide.box, w: guide.box.w || 0, h: guide.box.h || 0 })
      : center(view);
  if (guide.axis === "x") {
    const along = clamp(span.y + spread, view.y + VIEW_MARGIN_PX, view.y + view.h - VIEW_MARGIN_PX);
    return { x: view.x + RULER_INSET_PX, y: along };
  }
  const along = clamp(span.x + spread, view.x + VIEW_MARGIN_PX, view.x + view.w - VIEW_MARGIN_PX);
  return { x: along, y: view.y + RULER_INSET_PX };
}

export const guideTask: TaskBody<GuideLayer> = function* guide(scope, layer) {
  const { agent, stage } = scope;
  const axis = layer.axis === "y" ? "y" : "x";
  if (!Number.isFinite(layer.pos)) {
    stage.reveal(layer.id, 1);
    return;
  }
  const view = scope.viewport();
  const grab = rulerGrabPoint({ ...layer, axis }, view, agent.rng);
  yield* agent.moveTo(grab.x, grab.y);
  scope.cursor("resize");
  scope.press();
  const startPos = axis === "x" ? grab.x : grab.y;
  const line = scope.overlay("guide", { axis, pos: startPos, label: guideLabel(axis, startPos) });
  yield pick(agent.rng, GUIDE_GRAB_MS);

  const drop = clampPoint(
    axis === "x" ? { x: layer.pos, y: grab.y } : { x: grab.x, y: layer.pos },
    view,
    VIEW_MARGIN_PX,
  );
  yield* track(agent.dragTo(drop.x, drop.y, { dur: pick(agent.rng, GUIDE_DRAG_MS), ease: "inOut" }), () => {
    const pos = axis === "x" ? agent.x : agent.y;
    line.update({ axis, pos, label: guideLabel(axis, pos) });
  });
  // Off-screen positions: the line still lands exactly at `pos`.
  line.update({ axis, pos: layer.pos, label: guideLabel(axis, layer.pos), active: true });
  scope.release();
  scope.sound("snap");
  scope.sound("note", { pitch: 1, vel: GUIDE_NOTE_VEL });
  stage.reveal(layer.id, 1);
  yield pick(agent.rng, GUIDE_HOLD_MS);
  scope.drop(line);
};
