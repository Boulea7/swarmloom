/** Compound pointer gestures shared by several tasks. */

import type { OverlayHandle, Point, Rect, Yield } from "../types";
import {
  type Corner,
  center,
  clampPoint,
  cornerOf,
  distance,
  insetRect,
  intersect,
  lerpRect,
  oppositeCorner,
  rectFromPoints,
  sameRect,
  sizeText,
} from "./geometry";
import { click, easeOut, track, tween } from "./motion";
import type { TaskScope } from "./scope";
import { AUTOCOMPLETE_MS, dragDuration, MIN_DRAG_SIZE_PX, PRESS_HOLD_MS, pick, VIEW_MARGIN_PX } from "./timing";

export interface RectDragOptions {
  /** Corner the drag starts from. Default: the visible corner nearest to the cursor. */
  corner?: Corner;
  /** Dashed gray placeholder under the selection (boxes, images, media). */
  ghost?: boolean;
  /** Square handles on the selection outline. Default true. */
  handles?: boolean;
  /** Keep the size badge after the drag (the caller removes or relabels it). */
  keepBadge?: boolean;
}

/** Overlays left alive by {@link dragOutRect}; the caller drops them when its phase is over. */
export interface PlacedRect {
  ghost: OverlayHandle | null;
  selection: OverlayHandle;
  badge: OverlayHandle | null;
}

/** Live feedback of a rect being drawn: selection outline, size badge at the cursor, optional ghost. */
class RectFeedback {
  readonly ghost: OverlayHandle | null;
  readonly selection: OverlayHandle;
  readonly badge: OverlayHandle;

  constructor(
    scope: TaskScope,
    r: Rect,
    cursor: Point,
    private readonly handles: boolean,
    withGhost: boolean,
  ) {
    // Ghost first so the selection outline draws above it.
    this.ghost = withGhost ? scope.overlay("ghost-rect", { ...r, fill: true }) : null;
    this.selection = scope.overlay("selection", { ...r, handles });
    this.badge = scope.overlay("size-badge", { x: cursor.x, y: cursor.y, text: sizeText(r) });
  }

  show(r: Rect, cursor: Point): void {
    this.ghost?.update({ ...r, fill: true });
    this.selection.update({ ...r, handles: this.handles });
    this.badge.update({ x: cursor.x, y: cursor.y, text: sizeText(r) });
  }
}

const CORNERS: readonly Corner[] = ["tl", "tr", "bl", "br"];

/**
 * The corner of `r` nearest to `from` (less travel, and a crowd of cursors does not look cloned).
 * Ties go to the reading-order start corner (top-left).
 */
export function nearestCorner(r: Rect, from: Point): Corner {
  let best: Corner = "tl";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const corner of CORNERS) {
    const d = distance(cornerOf(r, corner), from);
    if (d < bestDistance - 0.5) {
      best = corner;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Crosshair drag that draws `target` from a corner: press, drag with a live selection, size badge
 * and (optionally) ghost placeholder, release. The cursor only drags the part of the rect inside
 * the viewport; the rest completes by itself after the release, so the operator never leaves the
 * screen. Tiny or fully off-screen rects are clicked into place.
 */
export function* dragOutRect(
  scope: TaskScope,
  target: Rect,
  opts: RectDragOptions = {},
): Generator<Yield, PlacedRect, unknown> {
  const { agent } = scope;
  const handles = opts.handles ?? true;
  const withGhost = opts.ghost ?? false;
  const view = scope.viewport();
  const visible = intersect(target, insetRect(view, VIEW_MARGIN_PX));
  let feedback: RectFeedback;

  scope.cursor("crosshair");
  if (!visible || (target.w < MIN_DRAG_SIZE_PX && target.h < MIN_DRAG_SIZE_PX)) {
    const at = clampPoint(center(target), view, VIEW_MARGIN_PX);
    yield* agent.moveTo(at.x, at.y);
    yield* click(scope);
    feedback = new RectFeedback(scope, target, at, handles, withGhost);
  } else {
    const corner = opts.corner ?? nearestCorner(visible, { x: agent.x, y: agent.y });
    const start = cornerOf(visible, corner);
    const end = cornerOf(visible, oppositeCorner(corner));
    yield* agent.moveTo(start.x, start.y);
    scope.press();
    yield pick(agent.rng, PRESS_HOLD_MS);
    const live = new RectFeedback(scope, rectFromPoints(start, start), start, handles, withGhost);
    feedback = live;
    const drag = agent.dragTo(end.x, end.y, { dur: dragDuration(distance(start, end)), ease: "inOut" });
    yield* track(drag, () => {
      const cursor = { x: agent.x, y: agent.y };
      live.show(rectFromPoints(start, cursor), cursor);
    });
    scope.release();
    if (!sameRect(visible, target)) {
      yield* tween(
        agent,
        pick(agent.rng, AUTOCOMPLETE_MS),
        (t) => live.show(lerpRect(visible, target, t), end),
        easeOut,
      );
    }
    live.show(target, end);
  }

  if (opts.keepBadge) return { ghost: feedback.ghost, selection: feedback.selection, badge: feedback.badge };
  scope.drop(feedback.badge);
  return { ghost: feedback.ghost, selection: feedback.selection, badge: null };
}

/**
 * Runs a layer's reveal 0 -> 1 over `durationMs`, dropping the drag placeholder as soon as the
 * reveal starts: from then on the stage draws the layer's own placeholder, so ours would only
 * cover the content.
 */
export function* revealOverGhost(
  scope: TaskScope,
  id: string,
  durationMs: number,
  ghost: OverlayHandle | null,
  ease: (t: number) => number,
): Generator<Yield, void, unknown> {
  let pending = ghost;
  yield* tween(
    scope.agent,
    durationMs,
    (t) => {
      scope.stage.reveal(id, t);
      if (t > 0 && pending) {
        scope.drop(pending);
        pending = null;
      }
    },
    ease,
  );
  scope.drop(pending);
}
