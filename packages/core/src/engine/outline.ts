import type { Rect } from "../types";
import type { Plan } from "./planner";

/** Cursors that draw the outline of an "outline" opening before the rest of the swarm comes in. */
export const OUTLINE_CREW = 3;
/** Shapes in the outline per outline cursor. */
const SHAPES_PER_CURSOR = 2;
/** Layer kinds that draw a shape (choreography keys; copies of a master are left to the swarm). */
const SHAPE_KEYS: ReadonlySet<string> = new Set(["path", "box"]);

/**
 * The outline of an "outline" opening: the paths and boxes with the largest boxes (by diagonal)
 * among those whose visible part is in sight of `vp`, two per outline cursor. Ties keep plan order,
 * so the choice depends only on the plan and the viewport.
 *
 * @param crew Outline cursors (the pool may be smaller than {@link OUTLINE_CREW}).
 * @returns A mask over the plan's nodes (1 = outline task), or null when nothing qualifies.
 */
export function outlineMask(plan: Plan, vp: Rect, crew: number): Uint8Array | null {
  const { keys, w, h, seenY, seenH, order } = plan;
  const top = vp.y;
  const bottom = vp.y + vp.h;
  const size = (i: number): number => Math.hypot(w[i] as number, h[i] as number);
  const candidates: number[] = [];
  for (const i of order) {
    const sh = seenH[i] as number;
    const sy = seenY[i] as number;
    if (!SHAPE_KEYS.has(keys[i] as string) || sh < 0 || sy > bottom || sy + sh < top || size(i) <= 0) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) return null;
  // Array.prototype.sort is stable: equal sizes keep plan order.
  candidates.sort((a, b) => size(b) - size(a));
  const mask = new Uint8Array(plan.nodeCount);
  for (const i of candidates.slice(0, Math.max(1, crew) * SHAPES_PER_CURSOR)) mask[i] = 1;
  return mask;
}
