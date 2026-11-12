/**
 * Guide snapping: text that snaps to a guide is typed beside it, then dragged onto it. Inside the
 * snap radius the offset across the guide drops to zero at once (a magnet, no overshoot), the
 * guide tightens and a snap sounds.
 */

import type { GuideLayer, Layer, Point, Rect, Rng, StageApi, TaskGen, TextLayer } from "../../types";
import { clampPoint, guideLabel, intersect, layerRect, offsetRect, translateValue } from "../geometry";
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

/** Gap kept between text typed beside its guide and neighbouring content, px. */
const SNAP_CLEARANCE_PX = 2;
/** Ancestor walks stop after this many steps (parent cycles in malformed input). */
const MAX_ANCESTORS = 64;

/**
 * Free space around a text, px: across its guide up to neighbouring content or the world's edge,
 * along it up to the world's edge (Infinity when nothing is in reach).
 */
export interface SnapRoom {
  /** Above the text (guide on axis "y") or left of it (axis "x"). */
  before: number;
  /** Below the text (axis "y") or right of it (axis "x"). */
  after: number;
  /** Along the guide: left of the text (axis "y") or above it (axis "x"). Default Infinity. */
  alongBefore?: number;
  /** Along the guide: right of the text (axis "y") or below it (axis "x"). Default Infinity. */
  alongAfter?: number;
}

/** Distance from `start`/`end` to the world's edges 0 and `limit` (Infinity when the size is unknown). */
function edgeRoom(start: number, end: number, limit: number | undefined): [number, number] {
  const known = typeof limit === "number" && Number.isFinite(limit) && limit > 0;
  return [Math.max(0, start), known ? Math.max(0, limit - end) : Number.POSITIVE_INFINITY];
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

function ancestorsOf(stage: StageApi, layer: Layer): Set<string> {
  const out = new Set<string>();
  let id = layer.parent;
  for (let steps = 0; id !== undefined && !out.has(id) && steps < MAX_ANCESTORS; steps++) {
    out.add(id);
    id = stage.layer(id)?.parent;
  }
  return out;
}

/**
 * How far text at `rect` can move around a guide on `axis` before it touches neighbouring
 * content or leaves the world (where a narrow stage, such as a watch face, cuts it off): across
 * the guide the nearest visible layer facing it on each side within reach of the largest offset,
 * or the world's edge when nearer; along the guide the world's edges. Ancestors, guides, layers
 * containing the text (backgrounds) and layers already overlapping it do not count. One pass over
 * the blueprint, done once per snapping text.
 */
export function snapRoom(stage: StageApi, layer: Layer, rect: Rect, axis: "x" | "y"): SnapRoom {
  const reach = SNAP_ACROSS_PX[1] + SNAP_CLEARANCE_PX;
  const slack = SNAP_ALONG_PX[1];
  const ancestors = ancestorsOf(stage, layer);
  const size = stage.blueprint.size;
  const horizontal = edgeRoom(rect.x, rect.x + rect.w, size?.w);
  const vertical = edgeRoom(rect.y, rect.y + rect.h, size?.h);
  const [across, along] = axis === "y" ? [vertical, horizontal] : [horizontal, vertical];
  const room: SnapRoom = { before: across[0], after: across[1], alongBefore: along[0], alongAfter: along[1] };
  for (const other of stage.blueprint.layers ?? []) {
    if (other === layer || other.id === layer.id || other.kind === "guide" || ancestors.has(other.id)) continue;
    const r = layerRect(other);
    if (!r || intersect(r, rect) || contains(r, rect)) continue;
    // Across a horizontal guide (axis "y") the text moves vertically, and the other way round.
    const [lo, hi, from, to] =
      axis === "y"
        ? [r.x, r.x + r.w, rect.x - slack, rect.x + rect.w + slack]
        : [r.y, r.y + r.h, rect.y - slack, rect.y + rect.h + slack];
    if (hi <= from || lo >= to) continue;
    const start = axis === "y" ? rect.y : rect.x;
    const end = axis === "y" ? rect.y + rect.h : rect.x + rect.w;
    const oStart = axis === "y" ? r.y : r.x;
    const oEnd = axis === "y" ? r.y + r.h : r.x + r.w;
    if (oEnd <= start && start - oEnd < reach) room.before = Math.min(room.before, start - oEnd);
    else if (oStart >= end && oStart - end < reach) room.after = Math.min(room.after, oStart - end);
  }
  return room;
}

/**
 * Where the text is typed relative to its final position: {@link SNAP_ACROSS_PX} across the
 * guide and {@link SNAP_ALONG_PX} along it, each on a random side. With `room`, the text never
 * covers neighbouring content or leaves the world: when the drawn side is too tight it moves to
 * the roomier one, and the distance shrinks to the free space there (down to zero: typed in place).
 */
export function snapOffset(rng: Rng, axis: "x" | "y", room?: SnapRoom): Point {
  let across = signed(rng, pick(rng, SNAP_ACROSS_PX));
  let along = signed(rng, pick(rng, SNAP_ALONG_PX));
  if (room) {
    const free = (sign: number): number => Math.max(0, (sign < 0 ? room.before : room.after) - SNAP_CLEARANCE_PX);
    const sign = Math.sign(across);
    const side = free(sign) >= Math.abs(across) || free(sign) >= free(-sign) ? sign : -sign;
    across = side * Math.min(Math.abs(across), free(side));
    const alongFree = along < 0 ? room.alongBefore : room.alongAfter;
    along = Math.sign(along) * Math.min(Math.abs(along), Math.max(0, alongFree ?? Number.POSITIVE_INFINITY));
  }
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
