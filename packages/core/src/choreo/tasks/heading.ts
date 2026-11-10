/**
 * Heading growth: a large heading is typed at a draft size, then the agent drags the text box's
 * corner handle outward and the font steps up through the document's own type scale to its final
 * size, one rising tick per step.
 */

import type { Blueprint, Rect, Rng, TaskGen, TextLayer } from "../../types";
import { clampPoint, isFinitePoint, lerp, px } from "../geometry";
import type { TaskScope } from "../scope";
import { type FontMetrics, scaleMetrics, textMetrics } from "../text-units";
import {
  BODY_FONT_PX,
  clamp,
  HEADING_DRAFT_RATIO,
  HEADING_MAX_GRAPHEMES,
  HEADING_MAX_LINES,
  HEADING_MAX_STEPS,
  HEADING_MAX_VIEW_SHARE,
  HEADING_MIN_PX,
  HEADING_MIN_STEPS,
  HEADING_ROLE_RATIO,
  HEADING_STEP_MS,
  HEADING_STEP_RATIO,
  PRESS_HOLD_MS,
  pick,
  VIEW_MARGIN_PX,
} from "../timing";
import type { EditFrame } from "./text-edit";

/** Smallest visible difference between two type sizes, px. */
const SIZE_TOLERANCE_PX = 1;

/** Font sizes used by a document's text layers. */
export interface TypeScale {
  /** Body size: the below-heading size covering the most text ({@link BODY_FONT_PX} if none). */
  body: number;
  /** Distinct sizes, ascending, rounded to 0.5 px. */
  sizes: number[];
}

const scales = new WeakMap<Blueprint, TypeScale>();

function roundSize(size: number): number {
  return Math.round(size * 2) / 2;
}

/** The type scale of a blueprint (computed once per blueprint). */
export function typeScale(blueprint: Blueprint): TypeScale {
  const cached = scales.get(blueprint);
  if (cached) return cached;
  const weight = new Map<number, number>();
  for (const layer of blueprint.layers ?? []) {
    if (layer.kind !== "text") continue;
    const size = roundSize(textMetrics(layer).fontSize);
    if (!(size > 0)) continue;
    const chars = typeof layer.text === "string" ? layer.text.length : 0;
    weight.set(size, (weight.get(size) ?? 0) + Math.max(1, chars));
  }
  let body = BODY_FONT_PX;
  let best = 0;
  for (const [size, w] of weight) {
    // Heading-sized text never counts as body, even on a page that is mostly headings.
    if (size >= HEADING_MIN_PX) continue;
    if (w > best || (w === best && size < body)) {
      body = size;
      best = w;
    }
  }
  const scale: TypeScale = { body, sizes: [...weight.keys()].sort((a, b) => a - b) };
  scales.set(blueprint, scale);
  return scale;
}

/** Size steps of a growing heading: typed at `draft`, then steps through `sizes` (last = final size). */
export interface HeadingGrowth {
  draft: number;
  sizes: number[];
}

/**
 * True for text that reads as a heading: a heading role, or a size of at least
 * {@link HEADING_MIN_PX} or {@link HEADING_ROLE_RATIO} times the body size.
 */
export function isHeading(layer: TextLayer, metrics: FontMetrics, scale: TypeScale): boolean {
  const size = metrics.fontSize;
  return layer.role === "heading" || size >= HEADING_MIN_PX || size >= scale.body * HEADING_ROLE_RATIO;
}

/** Evenly picks `n` items of `items`, always keeping the last one. */
function spread(items: readonly number[], n: number): number[] {
  if (items.length <= n) return [...items];
  const out: number[] = [];
  for (let i = 1; i <= n; i++) {
    const item = items[Math.round((i * items.length) / n) - 1];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/**
 * Stops between `draft` (exclusive) and `final` (inclusive): the document's own sizes when it has
 * at least {@link HEADING_MIN_STEPS} of them in range, otherwise a geometric ladder.
 */
export function headingSteps(draft: number, final: number, scale: TypeScale): number[] {
  const own = scale.sizes.filter((s) => s > draft + SIZE_TOLERANCE_PX && s < final - SIZE_TOLERANCE_PX);
  if (own.length >= HEADING_MIN_STEPS) return [...spread(own, HEADING_MAX_STEPS - 1), final];
  const ratio = final / draft;
  const count = clamp(Math.ceil(Math.log(ratio) / Math.log(HEADING_STEP_RATIO)), HEADING_MIN_STEPS, HEADING_MAX_STEPS);
  const steps: number[] = [];
  for (let i = 1; i < count; i++) steps.push(roundSize(draft * ratio ** (i / count)));
  steps.push(final);
  return steps;
}

/**
 * Growth plan for a heading, or null when the text is not a heading, is too long or too tall
 * (more than {@link HEADING_MAX_LINES} lines or {@link HEADING_MAX_VIEW_SHARE} of the viewport),
 * or would barely change size.
 */
export function planHeadingGrowth(
  layer: TextLayer,
  metrics: FontMetrics,
  rect: Rect,
  count: number,
  view: Rect,
  scale: TypeScale,
  rng: Rng,
): HeadingGrowth | null {
  const final = metrics.fontSize;
  if (!isHeading(layer, metrics, scale)) return null;
  if (count === 0 || count > HEADING_MAX_GRAPHEMES) return null;
  if (rect.h > metrics.lineHeight * HEADING_MAX_LINES) return null;
  if (view.h > 0 && rect.h > view.h * HEADING_MAX_VIEW_SHARE) return null;
  const draft = roundSize(Math.max(scale.body, final * pick(rng, HEADING_DRAFT_RATIO)));
  if (draft > final - 2 * SIZE_TOLERANCE_PX) return null;
  return { draft, sizes: headingSteps(draft, final, scale) };
}

/**
 * Drags the edit frame's corner handle outward while the font steps up through `growth.sizes`.
 * The frame follows the real layout (the caret after the last unit) at each step.
 */
export function* growHeading(
  scope: TaskScope,
  id: string,
  growth: HeadingGrowth,
  metrics: FontMetrics,
  count: number,
  frame: EditFrame,
  rect: Rect,
): TaskGen {
  const { agent, stage } = scope;
  const view = scope.viewport();
  const handleOf = (r: Rect) => clampPoint({ x: r.x + r.w, y: r.y + r.h }, view, VIEW_MARGIN_PX);
  frame.setHandles(true);
  const start = handleOf(frame.rect);
  scope.cursor("arrow");
  yield* agent.moveTo(start.x, start.y);
  scope.cursor("resize");
  scope.press();
  yield pick(agent.rng, PRESS_HOLD_MS);

  const from = frame.rect.h;
  const steps = growth.sizes.length;
  for (let i = 0; i < steps; i++) {
    const size = growth.sizes[i] ?? metrics.fontSize;
    scope.style.set({ "font-size": px(size) });
    scope.sound("tick", { pitch: i, vel: 0.45 + (0.4 * i) / Math.max(1, steps - 1) });
    const end = stage.caretAt(id, count);
    const lineH = scaleMetrics(metrics, size).lineHeight;
    const bottom = isFinitePoint(end) ? end.y + lineH : rect.y + lerp(from, rect.h, (i + 1) / steps);
    const h = clamp(bottom - rect.y, frame.rect.h, rect.h);
    const next: Rect = { ...frame.rect, h: i === steps - 1 ? Math.max(h, rect.h) : h };
    frame.set(next);
    const handle = handleOf(next);
    yield* agent.dragTo(handle.x, handle.y, { dur: pick(agent.rng, HEADING_STEP_MS), ease: "out" });
  }
  scope.release();
}
