/**
 * Duplicate: select the source (the master, or the nearest copy already made from it), alt-drag a
 * copy to the layer's place with a live spacing measurement, drop it, then make it its own:
 * double-click, select all and retype differing text, wipe in a differing image, repaint
 * differing styles.
 */

import type { CSSMap, Layer, OverlayHandle, Rect, StageApi, TaskGen, Yield } from "../../types";
import { center, clampPoint, distance, isFiniteRect, layerRect, offsetRect, px, translateValue } from "../geometry";
import { click, doubleClick, easeInOut, easeOut, linear, track, tween } from "../motion";
import { playPlacementNote } from "../notes";
import type { TaskBody, TaskScope } from "../scope";
import { textMetrics, typingUnits } from "../text-units";
import {
  DUP_BEAT_MS,
  DUP_DOUBLE_CLICK_GAP_MS,
  DUP_DRAG_OPACITY,
  DUP_HIGHLIGHT_MS,
  DUP_RESTYLE_MS,
  DUP_RETYPE_MAX_MS,
  DUP_RETYPE_SCALE,
  DUP_SELECT_HOLD_MS,
  DUP_SETTLE_MS,
  DUP_SWAP_MS,
  dragDuration,
  PRESS_HOLD_MS,
  pick,
  VIEW_MARGIN_PX,
} from "../timing";
import { typeInto } from "./text-edit";

/** Opacity at the middle of a restyle beat, where the copy switches to its own styles. */
const RESTYLE_DIP_OPACITY = 0.55;

/** Modifier badge shown while alt-dragging a copy: the Option glyph on Apple platforms, "Alt" elsewhere. */
export function modifierLabel(platform: string | undefined = currentPlatform()): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform ?? "") ? "\u2325" : "Alt";
}

function currentPlatform(): string | undefined {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  return nav?.platform || nav?.userAgent;
}

/** What has to change on the copy after the drop. */
export interface DuplicateEdits {
  /** Graphemes of the copy's own text, when it differs from the master's. */
  retype: string[] | null;
  /** Leading graphemes shared with the master's text: what the copy shows until it is retyped. */
  keep: number;
  /** The copy shows a different picture. */
  swapImage: boolean;
  /** Master values for styles that differ, shown on the copy until it is restyled. */
  restyle: CSSMap | null;
}

const PATH_PAINT: ReadonlyArray<readonly [string, (l: Layer) => string | undefined]> = [
  ["stroke", (l) => (l.kind === "path" ? l.stroke : undefined)],
  ["fill", (l) => (l.kind === "path" ? l.fill : undefined)],
  ["stroke-width", (l) => (l.kind === "path" && l.strokeWidth !== undefined ? px(l.strokeWidth) : undefined)],
];

function styleOf(layer: Layer): CSSMap | undefined {
  return "style" in layer ? layer.style : undefined;
}

/** Master values of every style the copy declares differently (keys the master lacks are skipped). */
export function styleDiff(copy: Layer, master: Layer): CSSMap | null {
  const out: CSSMap = {};
  const own = styleOf(copy) ?? {};
  const theirs = styleOf(master) ?? {};
  for (const key of Object.keys(own)) {
    const value = theirs[key];
    if (value !== undefined && value !== own[key]) out[key] = value;
  }
  if (copy.kind === "path" && master.kind === "path") {
    for (const [key, read] of PATH_PAINT) {
      const value = read(master);
      if (value !== undefined && value !== read(copy)) out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Differences between a copy and its master that the copy has to act out after the drop. */
export function duplicateEdits(copy: Layer, master: Layer): DuplicateEdits {
  let retype: string[] | null = null;
  let keep = 0;
  if (copy.kind === "text") {
    const own = typingUnits(typeof copy.text === "string" ? copy.text : "");
    const theirs = master.kind === "text" ? typingUnits(typeof master.text === "string" ? master.text : "") : [];
    keep = commonPrefix(own, theirs);
    if (keep < own.length || own.length !== theirs.length) retype = own;
    else keep = own.length;
  }
  const swapImage =
    copy.kind === "image" &&
    (master.kind !== "image" || master.src !== copy.src || JSON.stringify(master.crop) !== JSON.stringify(copy.crop));
  return { retype, keep, swapImage, restyle: styleDiff(copy, master) };
}

/**
 * Copies already finished, per stage and master (layer id -> rect), so later copies can continue
 * from the nearest one. Seeing a layer id again means the build was replayed: start over.
 */
const finishedCopies = new WeakMap<StageApi, Map<string, Map<string, Rect>>>();

function copiesOf(stage: StageApi, layerId: string): Map<string, Map<string, Rect>> {
  let byMaster = finishedCopies.get(stage);
  if (!byMaster) {
    byMaster = new Map();
    finishedCopies.set(stage, byMaster);
  }
  for (const copies of byMaster.values()) {
    if (copies.has(layerId)) {
      byMaster.clear();
      break;
    }
  }
  return byMaster;
}

/** Reading order: top to bottom, then left to right. */
function readsBefore(a: Rect, b: Rect): boolean {
  return a.y !== b.y ? a.y < b.y : a.x < b.x;
}

/** The master or finished copy nearest to `target`; ties go to the one that reads first. */
export function nearestSource(copies: Iterable<Rect>, masterRect: Rect, target: Rect): Rect {
  const goal = center(target);
  let best = masterRect;
  let bestDistance = distance(center(masterRect), goal);
  for (const r of copies) {
    const d = distance(center(r), goal);
    if (d < bestDistance - 0.5 || (Math.abs(d - bestDistance) <= 0.5 && readsBefore(r, best))) {
      best = r;
      bestDistance = d;
    }
  }
  return best;
}

/** Content the copy carries while dragged: everything the master shares with it. */
function carriedReveal(edits: DuplicateEdits): number {
  if (edits.swapImage) return 0;
  if (edits.retype) return edits.retype.length > 0 ? edits.keep / edits.retype.length : 1;
  return 1;
}

function* selectSource(scope: TaskScope, source: Rect): Generator<Yield, OverlayHandle, unknown> {
  const { agent } = scope;
  const at = clampPoint(
    { x: source.x + source.w * (0.3 + 0.4 * agent.rng()), y: source.y + source.h * (0.3 + 0.4 * agent.rng()) },
    scope.viewport(),
    VIEW_MARGIN_PX,
  );
  scope.cursor("arrow");
  yield* agent.moveTo(at.x, at.y);
  yield* click(scope);
  const selection = scope.overlay("selection", { ...source, handles: true });
  yield pick(agent.rng, DUP_SELECT_HOLD_MS);
  // The beat before the drag: the copy tool and the held modifier show up together.
  scope.cursor("copy");
  scope.say(modifierLabel());
  yield pick(agent.rng, DUP_BEAT_MS);
  return selection;
}

/** Alt-drags the copy from `source` to `target`; the copy follows the cursor with a spacing measure. */
function* dragCopy(scope: TaskScope, layer: Layer, source: Rect, target: Rect, edits: DuplicateEdits): TaskGen {
  const { agent, stage } = scope;
  const dx = source.x - target.x;
  const dy = source.y - target.y;
  const grab = { x: agent.x, y: agent.y };
  const view = scope.viewport();
  const drop = clampPoint({ x: grab.x - dx, y: grab.y - dy }, view, VIEW_MARGIN_PX);

  scope.press();
  if (edits.restyle) scope.style.set(edits.restyle);
  scope.style.set({ translate: translateValue(dx, dy), opacity: String(DUP_DRAG_OPACITY * (layer.opacity ?? 1)) });
  stage.reveal(layer.id, carriedReveal(edits));
  const ghost = carriedReveal(edits) < 1 ? scope.overlay("ghost-rect", { ...source, fill: true }) : null;
  const outline = scope.overlay("selection", { ...source, handles: false });
  const measure = scope.overlay("measure", { a: source, b: source });
  yield pick(agent.rng, PRESS_HOLD_MS);

  const place = (ox: number, oy: number): void => {
    const r = offsetRect(target, ox, oy);
    scope.style.set({ translate: translateValue(ox, oy) });
    ghost?.update({ ...r, fill: true });
    outline.update({ ...r, handles: false });
    measure.update({ a: source, b: r });
  };
  const drag = agent.dragTo(drop.x, drop.y, { dur: dragDuration(distance(grab, drop)), ease: "inOut" });
  yield* track(drag, () => place(agent.x - (grab.x - dx), agent.y - (grab.y - dy)));
  scope.release();
  scope.say("");

  // Drops that had to stay inside the viewport settle the rest of the way by themselves.
  const restX = drop.x - (grab.x - dx);
  const restY = drop.y - (grab.y - dy);
  yield* tween(agent, pick(agent.rng, DUP_SETTLE_MS), (t) => place(restX * (1 - t), restY * (1 - t)), easeOut);
  scope.style.unset(["translate", "opacity"]);
  playPlacementNote(scope, target);
  // A soft lower note under the placement marks "copy" rather than "new".
  playPlacementNote(scope, target, { vel: 0.24, shift: -0.2 });
  scope.drop(measure);
  scope.drop(ghost);
  scope.drop(outline);
}

/** Double-click, select all, delete and type the copy's own text. */
function* retype(scope: TaskScope, layer: Layer, target: Rect, units: string[]): TaskGen {
  const { agent, stage } = scope;
  if (layer.kind !== "text") return;
  scope.cursor("ibeam");
  yield* doubleClick(scope, DUP_DOUBLE_CLICK_GAP_MS);
  const highlight = scope.overlay("ghost-rect", { ...target, fill: true });
  yield pick(agent.rng, DUP_HIGHLIGHT_MS);
  scope.sound("key", { vel: 0.7 });
  stage.reveal(layer.id, 0);
  scope.drop(highlight);
  yield* typeInto(scope, layer.id, units, textMetrics(layer), null, {
    scale: DUP_RETYPE_SCALE,
    maxMs: DUP_RETYPE_MAX_MS,
  });
}

/** Wipes the copy's own picture in from the left edge. */
function* swapImage(scope: TaskScope, layer: Layer): TaskGen {
  const { agent, stage } = scope;
  stage.reveal(layer.id, 1);
  yield* tween(
    agent,
    pick(agent.rng, DUP_SWAP_MS),
    (t) => scope.style.set({ "clip-path": `inset(0 ${(100 * (1 - t)).toFixed(2)}% 0 0)` }),
    linear,
  );
  scope.style.unset(["clip-path"]);
}

/** A short repaint beat: the copy dims, switches from the master's styles to its own, comes back. */
function* restyle(scope: TaskScope, layer: Layer, keys: readonly string[]): TaskGen {
  const { agent } = scope;
  const opacity = layer.opacity ?? 1;
  let switched = false;
  yield* tween(
    agent,
    pick(agent.rng, DUP_RESTYLE_MS),
    (t) => {
      if (!switched && t >= 0.5) {
        switched = true;
        scope.style.unset(keys);
      }
      const dip = 1 - (1 - RESTYLE_DIP_OPACITY) * (1 - Math.abs(2 * t - 1));
      scope.style.set({ opacity: String(opacity * dip) });
    },
    easeInOut,
  );
  scope.style.unset(["opacity"]);
}

/** Makes the dropped copy its own: retype, swap, restyle (one selection for all of them). */
function* editCopy(scope: TaskScope, layer: Layer, target: Rect, edits: DuplicateEdits): TaskGen {
  const { agent } = scope;
  if (!edits.retype && !edits.swapImage && !edits.restyle) return;
  const at = clampPoint(center(target), scope.viewport(), VIEW_MARGIN_PX);
  scope.cursor("arrow");
  yield* agent.moveTo(at.x, at.y);
  const selection = scope.overlay("selection", { ...target, handles: !edits.retype });
  if (edits.retype) yield* retype(scope, layer, target, edits.retype);
  else yield* click(scope);
  if (edits.swapImage) yield* swapImage(scope, layer);
  if (edits.restyle) yield* restyle(scope, layer, Object.keys(edits.restyle));
  scope.drop(selection);
}

/**
 * Builds the duplicate task. `fallback` runs when the master is missing or unusable, so a broken
 * reference still gets the regular choreography of the layer's kind.
 */
export function createDuplicateTask(fallback: TaskBody<Layer>): TaskBody<Layer> {
  return function* duplicate(scope, layer) {
    const { stage } = scope;
    const target = layerRect(layer);
    const master = layer.master !== undefined && layer.master !== layer.id ? stage.layer(layer.master) : undefined;
    const masterRect = master ? layerRect(master) : null;
    if (!target || !master || !masterRect || !isFiniteRect(masterRect)) {
      yield* fallback(scope, layer);
      return;
    }
    const registry = copiesOf(stage, layer.id);
    const source = nearestSource(registry.get(master.id)?.values() ?? [], masterRect, target);
    const edits = duplicateEdits(layer, master);
    const selection = yield* selectSource(scope, source);
    yield* dragCopy(scope, layer, source, target, edits);
    scope.drop(selection);
    yield* editCopy(scope, layer, target, edits);
    stage.reveal(layer.id, 1);
    const copies = registry.get(master.id) ?? new Map<string, Rect>();
    copies.set(layer.id, target);
    registry.set(master.id, copies);
  };
}
