/**
 * Path: pen tool. The cursor clicks every anchor (pen sound), a rubber band follows it from the
 * last anchor and stays as a chord once the next anchor lands; then the real stroke is traced
 * with `stage.reveal` and fills fade in after the strokes. Complex paths are traced continuously.
 */

import type { CSSMap, OverlayHandle, PathLayer, Point, TaskGen, Yield } from "../../types";
import { clampPoint, distance } from "../geometry";
import { easeInOut, easeOut, track, tween } from "../motion";
import { type PathAnchors, parsePathAnchors, pathMode, samplePath } from "../path-data";
import type { TaskBody, TaskScope } from "../scope";
import {
  FILL_FADE_MS,
  PEN_CLICK_MS,
  PEN_LIFT_MS,
  penMoveDuration,
  pick,
  TRACE_SAMPLES,
  traceDuration,
  VIEW_MARGIN_PX,
} from "../timing";
import { fadeIn } from "./fade";

/** Neutral outline for fill-only shapes whose fill is not a plain colour (gradients, patterns). */
const OUTLINE_FALLBACK = "#8a8a99";
const OUTLINE_WIDTH = "1.5px";

function paintOf(value: string | undefined): string | null {
  const v = value?.trim();
  return v && v !== "none" && v !== "transparent" ? v : null;
}

/** How the stroke and fill of a path are staged. */
interface PaintPlan {
  /** Transient styles while anchors are placed and the stroke is traced. */
  during: CSSMap;
  /** Final fill opacity to fade to, or null when there is no fill to fade. */
  fillOpacity: number | null;
}

function paintPlan(layer: PathLayer): PaintPlan {
  const attrs = layer.attrs ?? {};
  const stroke = paintOf(layer.stroke ?? attrs.stroke);
  const fill = paintOf(layer.fill ?? attrs.fill);
  const width = layer.strokeWidth ?? Number.parseFloat(attrs["stroke-width"] ?? "1");
  const hasStroke = stroke !== null && !(width <= 0);
  const during: CSSMap = {};
  if (fill) during["fill-opacity"] = "0";
  if (!hasStroke && fill) {
    // Fill-only shapes get a temporary outline so the trace has something to draw.
    during.stroke = fill.startsWith("url(") ? OUTLINE_FALLBACK : fill;
    during["stroke-width"] = OUTLINE_WIDTH;
  }
  const opacity = Number(attrs["fill-opacity"] ?? 1);
  return { during, fillOpacity: fill ? (Number.isFinite(opacity) ? opacity : 1) : null };
}

/** Clicks every anchor; returns the anchor and segment overlays, which stay until the stroke is traced. */
function* placeAnchors(scope: TaskScope, path: PathAnchors): Generator<Yield, OverlayHandle[], unknown> {
  const { agent } = scope;
  const placed: OverlayHandle[] = [];
  let lastAnchor: { handle: OverlayHandle; at: Point } | null = null;
  for (const points of path.subpaths) {
    let previous: Point | null = null;
    for (const point of points) {
      const aim = clampPoint(point, scope.viewport(), VIEW_MARGIN_PX);
      if (previous) {
        const from: Point = previous;
        const band = scope.overlay("rubber-band", { x1: from.x, y1: from.y, x2: agent.x, y2: agent.y });
        placed.push(band);
        const move = agent.moveTo(aim.x, aim.y, { dur: penMoveDuration(distance(agent, aim)), ease: "inOut" });
        yield* track(move, () => band.update({ x1: from.x, y1: from.y, x2: agent.x, y2: agent.y }));
        // The band stays as the placed segment until the real stroke is traced.
        band.update({ x1: from.x, y1: from.y, x2: point.x, y2: point.y });
      } else {
        yield* agent.moveTo(aim.x, aim.y);
      }
      scope.press("pen");
      yield pick(agent.rng, PEN_CLICK_MS);
      scope.release(null);
      lastAnchor?.handle.update({ x: lastAnchor.at.x, y: lastAnchor.at.y, active: false });
      const handle = scope.overlay("anchor", { x: point.x, y: point.y, active: true });
      placed.push(handle);
      lastAnchor = { handle, at: point };
      previous = point;
    }
  }
  return placed;
}

/** Continuous trace for complex paths: the pen runs through sampled anchors while the stroke follows. */
function* traceAlong(scope: TaskScope, layer: PathLayer, path: PathAnchors): TaskGen {
  const { agent, stage } = scope;
  const samples = samplePath(path, TRACE_SAMPLES);
  const first = samples[0];
  if (!first) return;
  const view = scope.viewport();
  const start = clampPoint(first.p, view, VIEW_MARGIN_PX);
  yield* agent.moveTo(start.x, start.y);
  scope.press("pen");
  const total = traceDuration(path.length);
  let reached = 0;
  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    if (!sample) continue;
    const from = reached;
    const aim = clampPoint(sample.p, scope.viewport(), VIEW_MARGIN_PX);
    const origin = { x: agent.x, y: agent.y };
    const span = Math.max(1, distance(origin, aim));
    const dur = Math.max(40, total * (sample.at - from));
    yield* track(agent.dragTo(aim.x, aim.y, { dur, ease: "linear" }), () => {
      const f = Math.min(1, distance(origin, agent) / span);
      stage.reveal(layer.id, from + (sample.at - from) * f);
    });
    reached = sample.at;
  }
  stage.reveal(layer.id, 1);
  scope.release(null);
}

export const pathTask: TaskBody<PathLayer> = function* path(scope, layer) {
  const { agent, stage } = scope;
  const anchors = parsePathAnchors(layer.d);
  if (anchors.count === 0) {
    // Nothing to put a pen on (empty or malformed data): reveal it plainly.
    yield* fadeIn(scope, layer);
    return;
  }
  const mode = pathMode(layer.reveal, anchors);
  if (mode === "fade") {
    yield* fadeIn(scope, layer);
    return;
  }
  const plan = paintPlan(layer);
  if (Object.keys(plan.during).length > 0) scope.style.set(plan.during);
  scope.cursor("pen");

  if (mode === "pen") {
    const placed = yield* placeAnchors(scope, anchors);
    const lift = clampPoint({ x: agent.x + 14, y: agent.y + 10 }, scope.viewport(), VIEW_MARGIN_PX);
    yield* agent.moveTo(lift.x, lift.y, { dur: pick(agent.rng, PEN_LIFT_MS), ease: "out" });
    yield* tween(agent, traceDuration(anchors.length), (t) => stage.reveal(layer.id, t), easeInOut);
    for (const handle of placed) scope.drop(handle);
  } else {
    yield* traceAlong(scope, layer, anchors);
  }

  const fillOpacity = plan.fillOpacity;
  if (fillOpacity !== null) {
    yield* tween(
      agent,
      pick(agent.rng, FILL_FADE_MS),
      (t) => {
        scope.style.set({ "fill-opacity": String(Math.round(t * fillOpacity * 1000) / 1000) });
      },
      easeOut,
    );
  }
  scope.style.clear();
  stage.reveal(layer.id, 1);
};
