/**
 * A small stand-in for the engine, used by the adapter tests while `createPlayer` is a stub on
 * main: mounts every layer (custom layers through their plugin renderer), then runs the plugin
 * tasks in build order (parents and masters first), stepping generators with a virtual clock and
 * a scripted cursor. It checks what the engine relies on: every task finishes, stays under the
 * watchdog, and leaves its layer finished.
 */

import type {
  AgentApi,
  CursorShape,
  Layer,
  LayerRenderer,
  LoadedSource,
  OverlayHandle,
  Plugin,
  Point,
  Rect,
  StageApi,
  TaskFn,
  TaskGen,
} from "@swarmloom/core";
import { createRng } from "@swarmloom/core";

/** The engine aborts a task after max(estimate * 8, 20 s); custom layers estimate 800 ms. */
export const WATCHDOG_MS = 20_000;

export interface RunReport {
  host: HTMLElement;
  stage: StageApi;
  /** Engine time spent per task, ms, by layer id. */
  taskMs: Map<string, number>;
  /** Layer ids in the order their build started. */
  order: string[];
  finished: Set<string>;
  reveals: Map<string, number[]>;
  sounds: string[];
  bubbles: string[];
  cursors: CursorShape[];
  overlays: string[];
  /** Total engine time, ms (tasks run one after another here). */
  total: number;
  /** Releases mounted renderers. */
  dispose(): void;
}

function buildOrder(layers: readonly Layer[]): Layer[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const done = new Set<string>();
  const out: Layer[] = [];
  const visit = (l: Layer, depth: number): void => {
    if (done.has(l.id) || depth > layers.length) return;
    for (const dep of [l.parent, l.master]) {
      const d = dep ? byId.get(dep) : undefined;
      if (d) visit(d, depth + 1);
    }
    if (done.has(l.id)) return;
    done.add(l.id);
    out.push(l);
  };
  const sorted = [...layers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  for (const l of sorted) visit(l, 0);
  return out;
}

/** Mounts and builds a loaded source to the end. */
export async function runLoaded(loaded: LoadedSource, doc: Document = document, seed = 7): Promise<RunReport> {
  const { blueprint } = loaded;
  const plugins: Plugin[] = loaded.plugins ?? [];
  const renderers = new Map<string, LayerRenderer<Layer>>();
  const tasks = new Map<string, TaskFn<Layer>>();
  for (const p of plugins) {
    for (const [k, r] of Object.entries(p.renderers ?? {})) renderers.set(k, r as LayerRenderer<Layer>);
    for (const [k, t] of Object.entries(p.tasks ?? {})) tasks.set(k, t as TaskFn<Layer>);
  }
  const host = doc.createElement("div");
  host.style.cssText = `position:relative;width:${blueprint.size.w}px;height:${blueprint.size.h}px;background:${blueprint.background}`;
  if (blueprint.css) {
    const style = doc.createElement("style");
    style.textContent = blueprint.css;
    host.append(style);
  }
  doc.body.append(host);
  const byId = new Map(blueprint.layers.map((l) => [l.id, l]));
  const els = new Map<string, HTMLElement | SVGElement>();
  const report: RunReport = {
    host,
    stage: undefined as unknown as StageApi,
    taskMs: new Map(),
    order: [],
    finished: new Set(),
    reveals: new Map(),
    sounds: [],
    bubbles: [],
    cursors: [],
    overlays: [],
    total: 0,
    dispose: () => undefined,
  };
  const keyOf = (l: Layer): string => (l.kind === "custom" ? l.task : l.kind);
  const stage: StageApi = {
    blueprint,
    layer: (id) => byId.get(id),
    el: (id) => els.get(id) ?? null,
    reveal(id, p) {
      if (!(p >= 0 && p <= 1)) throw new RangeError(`reveal(${id}, ${p}) out of range`);
      const l = byId.get(id);
      if (!l) throw new Error(`reveal of unknown layer ${id}`);
      const list = report.reveals.get(id) ?? [];
      list.push(p);
      report.reveals.set(id, list);
      renderers.get(keyOf(l))?.reveal(l, p);
    },
    finish(id) {
      const l = byId.get(id);
      if (!l) throw new Error(`finish of unknown layer ${id}`);
      report.finished.add(id);
      renderers.get(keyOf(l))?.finish?.(l);
    },
    setStyle: () => undefined,
    overlay(kind): OverlayHandle {
      report.overlays.push(kind);
      return { update: () => undefined, remove: () => undefined };
    },
    viewport: (): Rect => ({ x: 0, y: 0, w: blueprint.size.w, h: Math.min(blueprint.size.h, 900) }),
    caretAt(id, n): Point {
      const l = byId.get(id);
      return l ? { x: l.box.x + Math.min(l.box.w, n * 8), y: l.box.y + l.box.h / 2 } : { x: 0, y: 0 };
    },
  };
  report.stage = stage;

  for (const l of blueprint.layers) {
    const box = doc.createElement("div");
    box.dataset.layer = l.id;
    box.style.cssText = `position:absolute;left:${l.box.x}px;top:${l.box.y}px;width:${l.box.w}px;height:${l.box.h}px;z-index:${l.z ?? 0}`;
    host.append(box);
    const r = renderers.get(keyOf(l));
    if (r) {
      const el = r.mount(l, box, stage);
      if (el) els.set(l.id, el);
    } else if (l.kind === "text") {
      box.innerHTML = l.html;
      els.set(l.id, box);
    } else {
      els.set(l.id, box);
    }
  }

  let now = 0;
  let x = 0;
  let y = 0;
  const rng = createRng(seed);
  const frame = (): void => {
    for (const p of plugins) p.frame?.(now, 16);
  };
  function* travel(tx: number, ty: number, opts?: { dur?: number }): TaskGen {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) throw new RangeError(`moveTo(${tx}, ${ty})`);
    const dur = opts?.dur ?? 240;
    yield dur;
    x = tx;
    y = ty;
  }
  const agent: AgentApi = {
    id: 0,
    name: "Test",
    color: "#14B8A6",
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    rng,
    moveTo: travel,
    dragTo: travel,
    press: () => undefined,
    release: () => undefined,
    setCursor: (shape) => {
      report.cursors.push(shape);
    },
    say: (text) => {
      if (text) report.bubbles.push(text);
    },
    sound: (name) => {
      report.sounds.push(name);
    },
  };

  for (const l of buildOrder(blueprint.layers)) {
    const task = tasks.get(keyOf(l));
    report.order.push(l.id);
    if (!task) {
      stage.finish(l.id);
      continue;
    }
    const start = now;
    const gen = task(agent, l, stage);
    for (let r = gen.next(); !r.done; r = gen.next()) {
      const v = r.value;
      if (typeof v === "number") {
        if (!(v >= 0) || !Number.isFinite(v)) throw new RangeError(`${l.id} yielded ${v}`);
        now += v;
      } else if (v === undefined) now += 16;
      else await v;
      frame();
      if (now - start > WATCHDOG_MS * 2) throw new Error(`${l.id} runs away`);
    }
    report.taskMs.set(l.id, now - start);
  }
  report.total = now;
  frame();
  report.dispose = () => {
    for (const l of blueprint.layers) renderers.get(keyOf(l))?.unmount?.(l);
    host.remove();
    loaded.dispose?.();
  };
  return report;
}
