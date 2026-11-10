/**
 * Recording fakes of AgentApi and StageApi for choreography tests, plus a synchronous runner
 * that plays a task generator on a virtual timeline (numbers wait that long, undefined waits one
 * frame).
 */

import type { ClockedAgent } from "../../src/choreo/motion";
import { createRng } from "../../src/rng";
import type {
  AgentApi,
  Blueprint,
  CSSMap,
  CursorShape,
  Ease,
  Layer,
  OverlayHandle,
  OverlayKind,
  Point,
  Rect,
  SoundName,
  StageApi,
  TaskFn,
  TaskGen,
} from "../../src/types";

export const FRAME_MS = 16;

export type LogEntry =
  | { t: number; type: "sound"; name: SoundName; pitch?: number; vel?: number }
  | { t: number; type: "press" | "release" }
  | { t: number; type: "cursor"; shape: CursorShape }
  | { t: number; type: "say"; text: string }
  | {
      t: number;
      type: "overlay";
      op: "add" | "update" | "remove";
      kind: OverlayKind;
      handle: number;
      props?: Record<string, unknown>;
    }
  | { t: number; type: "reveal"; id: string; p: number }
  | { t: number; type: "finish"; id: string }
  | { t: number; type: "style"; id: string; css: CSSMap | null };

type Untimed<T> = T extends unknown ? Omit<T, "t"> : never;

export class Timeline {
  now = 0;
  readonly log: LogEntry[] = [];

  push(entry: Untimed<LogEntry>): void {
    this.log.push({ t: this.now, ...entry } as LogEntry);
  }

  /** Index of the last entry matching `pred`, or -1. */
  lastIndex(pred: (e: LogEntry) => boolean): number {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const entry = this.log[i];
      if (entry && pred(entry)) return i;
    }
    return -1;
  }

  of<T extends LogEntry["type"]>(type: T): Array<Extract<LogEntry, { type: T }>> {
    return this.log.filter((e): e is Extract<LogEntry, { type: T }> => e.type === type);
  }

  sounds(...names: SoundName[]): Array<Extract<LogEntry, { type: "sound" }>> {
    return this.of("sound").filter((e) => names.includes(e.name));
  }
}

export interface FakeAgentOptions {
  seed?: number;
  /** Expose `now()` (the optional engine task clock). Default true. */
  clock?: boolean;
  start?: Point;
}

export function fakeAgent(
  timeline: Timeline,
  opts: FakeAgentOptions = {},
): ClockedAgent & { pressed: boolean; shape: CursorShape } {
  const rng = createRng(opts.seed ?? 1);
  const state = { x: opts.start?.x ?? 40, y: opts.start?.y ?? 40, pressed: false, shape: "arrow" as CursorShape };
  function* travel(x: number, y: number, o?: { dur?: number; ease?: Ease }): TaskGen {
    const fromX = state.x;
    const fromY = state.y;
    const steps = Math.max(1, Math.ceil((o?.dur ?? 240) / FRAME_MS));
    for (let i = 1; i <= steps; i++) {
      yield undefined;
      state.x = fromX + ((x - fromX) * i) / steps;
      state.y = fromY + ((y - fromY) * i) / steps;
    }
  }
  const agent: ClockedAgent & { pressed: boolean; shape: CursorShape } = {
    id: 1,
    name: "Ada",
    color: "#5B5BF7",
    get x() {
      return state.x;
    },
    get y() {
      return state.y;
    },
    get pressed() {
      return state.pressed;
    },
    get shape() {
      return state.shape;
    },
    rng,
    moveTo: travel,
    dragTo: travel,
    press() {
      state.pressed = true;
      timeline.push({ type: "press" });
    },
    release() {
      state.pressed = false;
      timeline.push({ type: "release" });
    },
    setCursor(shape) {
      state.shape = shape;
      timeline.push({ type: "cursor", shape });
    },
    say(text) {
      timeline.push({ type: "say", text });
    },
    sound(name, o) {
      timeline.push({ type: "sound", name, pitch: o?.pitch, vel: o?.vel });
    },
  };
  if (opts.clock ?? true) agent.now = () => timeline.now;
  return agent;
}

export interface FakeStage extends StageApi {
  /** Overlays added and not removed yet. */
  readonly live: Map<number, { kind: OverlayKind; props: Record<string, unknown> }>;
  readonly progress: Map<string, number>;
  readonly finished: string[];
  /** Throws from caretAt when set (error-path tests). */
  failCaret: boolean;
}

export function blueprintOf(layers: Layer[], viewport: Rect = { x: 0, y: 0, w: 1280, h: 800 }): Blueprint {
  return {
    version: 1,
    source: { type: "test" },
    size: { w: viewport.w, h: 3000 },
    viewport: { w: viewport.w, h: viewport.h },
    background: "#fff",
    layers,
  };
}

export function fakeStage(
  timeline: Timeline,
  layers: Layer[],
  viewport: Rect = { x: 0, y: 0, w: 1280, h: 800 },
): FakeStage {
  const blueprint = blueprintOf(layers, viewport);
  const byId = new Map(layers.map((l) => [l.id, l]));
  const live = new Map<number, { kind: OverlayKind; props: Record<string, unknown> }>();
  const progress = new Map<string, number>();
  const finished: string[] = [];
  let nextHandle = 1;
  const stage: FakeStage = {
    blueprint,
    live,
    progress,
    finished,
    failCaret: false,
    layer: (id) => byId.get(id),
    el: () => null,
    reveal(id, p) {
      if (!(p >= 0 && p <= 1)) throw new RangeError(`reveal(${id}) out of range: ${p}`);
      progress.set(id, p);
      timeline.push({ type: "reveal", id, p });
    },
    finish(id) {
      finished.push(id);
      progress.set(id, 1);
      timeline.push({ type: "finish", id });
    },
    setStyle(id, css) {
      timeline.push({ type: "style", id, css: css ? { ...css } : null });
    },
    overlay(kind, props): OverlayHandle {
      const handle = nextHandle++;
      live.set(handle, { kind, props: { ...props } });
      timeline.push({ type: "overlay", op: "add", kind, handle, props: { ...props } });
      return {
        update(next) {
          const entry = live.get(handle);
          if (!entry) throw new Error(`update after remove: ${kind}#${handle}`);
          entry.props = { ...next };
          timeline.push({ type: "overlay", op: "update", kind, handle, props: { ...next } });
        },
        remove() {
          if (!live.delete(handle)) throw new Error(`double remove: ${kind}#${handle}`);
          timeline.push({ type: "overlay", op: "remove", kind, handle });
        },
      };
    },
    viewport: () => ({ ...viewport }),
    caretAt(id, n) {
      if (stage.failCaret) throw new Error("caretAt failed");
      const layer = byId.get(id);
      const box = layer?.box ?? { x: 0, y: 0, w: 0, h: 0 };
      const perLine = Math.max(1, Math.floor(box.w / 9));
      return { x: box.x + (n % perLine) * 9, y: box.y + Math.floor(n / perLine) * 20 };
    },
  };
  return stage;
}

/**
 * Plays a task to completion on the virtual timeline. `maxSteps` guards against generators that
 * never end. Returns the engine time the task took.
 */
export function run(
  task: TaskFn<Layer>,
  agent: AgentApi,
  layer: Layer,
  stage: StageApi,
  timeline: Timeline,
  maxSteps = 200_000,
): number {
  const start = timeline.now;
  const gen = task(agent, layer, stage);
  for (let i = 0; i < maxSteps; i++) {
    const step = gen.next();
    if (step.done) return timeline.now - start;
    const value = step.value;
    if (typeof value === "number") {
      if (!(value >= 0) || !Number.isFinite(value)) throw new RangeError(`bad wait ${value}`);
      timeline.now += value;
    } else if (value === undefined) {
      timeline.now += FRAME_MS;
    } else {
      throw new Error("tasks must not yield promises in tests (no assets)");
    }
  }
  throw new Error("task did not finish");
}

/** Steps a task `steps` times without finishing it (abort tests). */
export function startTask(
  task: TaskFn<Layer>,
  agent: AgentApi,
  layer: Layer,
  stage: StageApi,
  timeline: Timeline,
  steps: number,
): TaskGen {
  const gen = task(agent, layer, stage);
  for (let i = 0; i < steps; i++) {
    const step = gen.next();
    if (step.done) break;
    timeline.now += typeof step.value === "number" ? step.value : FRAME_MS;
  }
  return gen;
}
