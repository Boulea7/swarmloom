/**
 * Test doubles for the engine: an in-memory Stage that hashes every rendered frame, a recording
 * Sound engine, a small deterministic choreography plugin and blueprint builders.
 */
import { VirtualClock } from "../../src/clock";
import { Engine, type EngineDeps, type EngineSettings } from "../../src/engine/engine";
import type { AgentView, ResolvedTheme, SoundEngine, Stage } from "../../src/internal";
import type {
  AgentApi,
  Blueprint,
  CSSMap,
  Layer,
  OverlayHandle,
  OverlayKind,
  Plugin,
  Point,
  Rect,
  SoundEvent,
  StageApi,
  TaskGen,
} from "../../src/types";

/** FNV-1a over raw bytes; used to fingerprint frame traces. */
class TraceHash {
  #h = 0x811c9dc5;
  readonly #f64 = new Float64Array(1);
  readonly #bytes = new Uint8Array(this.#f64.buffer);

  get value(): number {
    return this.#h >>> 0;
  }

  reset(): void {
    this.#h = 0x811c9dc5;
  }

  num(v: number): void {
    this.#f64[0] = v;
    for (const b of this.#bytes) this.#byte(b);
  }

  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.#byte(s.charCodeAt(i) & 0xff);
    this.#byte(0);
  }

  #byte(b: number): void {
    this.#h = Math.imul(this.#h ^ b, 0x01000193);
  }
}

export interface FakeOverlay {
  kind: OverlayKind;
  props: Record<string, unknown>;
  removed: boolean;
}

/**
 * Stage without DOM rendering. Viewport = scroll offset + fixed size inside the blueprint world.
 * Records reveals, finishes (in order), live overlays and a hash of every rendered frame.
 */
export class FakeStage implements Stage {
  readonly blueprint: Blueprint;
  readonly root: ShadowRoot;
  readonly uiLayer: HTMLElement;
  readonly reveals = new Map<string, number>();
  readonly finished: string[] = [];
  readonly overlays: FakeOverlay[] = [];
  readonly hash = new TraceHash();
  /** Number of agents drawn per render call. */
  readonly drawn: number[] = [];
  scrollX = 0;
  scrollY = 0;
  rulers = false;
  pointerAt: Point | null = null;
  readyPromise: Promise<void> = Promise.resolve();
  calls = { enter: 0, reset: 0, goLive: 0, finishAll: 0, destroy: 0 };
  /** Keep per-frame records (off for benchmarks). */
  record = true;
  readonly #width: number;
  readonly #height: number;
  readonly #scrollFns = new Set<(y: number) => void>();

  constructor(blueprint: Blueprint, viewport: { w: number; h: number } = { w: 800, h: 600 }) {
    this.blueprint = blueprint;
    this.#width = viewport.w;
    this.#height = viewport.h;
    const host = document.createElement("div");
    this.root = host.attachShadow({ mode: "open" });
    this.uiLayer = document.createElement("div");
    this.root.append(this.uiLayer);
  }

  /** Overlays currently shown (created and not removed). */
  live(kind?: OverlayKind): FakeOverlay[] {
    return this.overlays.filter((o) => !o.removed && (kind === undefined || o.kind === kind));
  }

  /** Simulates a user scroll (wheel/touch). */
  userScroll(y: number): void {
    this.scrollTo(y);
    for (const fn of this.#scrollFns) fn(this.scrollY);
  }

  layer(id: string): Layer | undefined {
    return this.blueprint.layers.find((l) => l.id === id);
  }

  el(): HTMLElement | null {
    return null;
  }

  reveal(id: string, p: number): void {
    this.reveals.set(id, p);
  }

  finish(id: string): void {
    this.reveals.set(id, 1);
    if (this.record) this.finished.push(id);
  }

  setStyle(_id: string, _css: CSSMap | null): void {}

  overlay(kind: OverlayKind, props: Record<string, unknown>): OverlayHandle {
    const entry: FakeOverlay = { kind, props: { ...props }, removed: false };
    if (this.record || kind === "halo" || kind === "icon") this.overlays.push(entry);
    return {
      update: (next) => {
        entry.props = { ...next };
      },
      remove: () => {
        entry.removed = true;
      },
    };
  }

  viewport(): Rect {
    return { x: this.scrollX, y: this.scrollY, w: this.#width, h: this.#height };
  }

  caretAt(id: string, n: number): Point {
    const l = this.layer(id);
    return { x: (l?.box.x ?? 0) + n * 8, y: l?.box.y ?? 0 };
  }

  scrollTo(y: number): void {
    const max = Math.max(0, this.blueprint.size.h - this.#height);
    this.scrollY = Math.min(max, Math.max(0, y));
  }

  onUserScroll(fn: (y: number) => void): () => void {
    this.#scrollFns.add(fn);
    return () => this.#scrollFns.delete(fn);
  }

  onResize(): () => void {
    return () => {};
  }

  setRulers(on: boolean): void {
    this.rulers = on;
  }

  /** Agents in the latest rendered frame (kept even when `record` is off). */
  lastDrawn = 0;

  render(now: number, agents: readonly AgentView[]): void {
    this.lastDrawn = agents.length;
    if (!this.record) return;
    const h = this.hash;
    h.num(now);
    for (const a of agents) {
      h.num(a.id);
      h.num(a.x);
      h.num(a.y);
      h.num(a.alpha);
      h.num(a.scale);
      h.num(a.angle ?? -99);
      h.str(a.shape);
      h.str(a.label);
      h.str(a.bubble);
      h.num(a.pressed ? 1 : 0);
    }
    this.drawn.push(agents.length);
  }

  async enter(): Promise<void> {
    this.calls.enter++;
  }

  finishAll(): void {
    this.calls.finishAll++;
    for (const l of this.blueprint.layers) this.reveals.set(l.id, 1);
  }

  reset(): void {
    this.calls.reset++;
    this.reveals.clear();
    this.finished.length = 0;
    this.drawn.length = 0;
    this.hash.reset();
  }

  async goLive(): Promise<void> {
    this.calls.goLive++;
  }

  pointer(): Point | null {
    return this.pointerAt;
  }

  toClient(p: Point): Point {
    return { x: p.x - this.scrollX, y: p.y - this.scrollY };
  }

  toStage(p: Point): Point {
    return { x: p.x + this.scrollX, y: p.y + this.scrollY };
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  destroy(): void {
    this.calls.destroy++;
  }
}

/** Sound engine that records what it is asked to play. */
export class FakeSound implements SoundEngine {
  readonly played: SoundEvent[] = [];
  enabled = true;
  locked = false;
  levelsValue: { level: number; bands: Float32Array } | null = null;
  destroyed = false;

  play(ev: SoundEvent): void {
    this.played.push(ev);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  async unlock(): Promise<void> {}

  onLockChange(): () => void {
    return () => {};
  }

  levels(): { level: number; bands: Float32Array } | null {
    return this.levelsValue;
  }

  async useMicrophone(): Promise<boolean> {
    return false;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/** Box choreography: travel, press, drag the size out, release, reveal with a note. */
export function* boxTask(agent: AgentApi, layer: Layer, stage: StageApi): TaskGen {
  const { x, y, w, h } = layer.box;
  yield* agent.moveTo(x, y);
  agent.setCursor("crosshair");
  agent.press();
  agent.sound("press");
  const ghost = stage.overlay("ghost-rect", { x, y, w: 0, h: 0 });
  try {
    yield* agent.dragTo(x + w, y + h);
    agent.release();
    agent.sound("release");
    yield 40 + agent.rng() * 60;
    stage.reveal(layer.id, 1);
    agent.sound("note", { pitch: 0.5, vel: 0.8 });
  } finally {
    ghost.remove();
  }
  stage.finish(layer.id);
}

/** Text choreography: one key sound per character, 30 ms apart. */
export function* textTask(agent: AgentApi, layer: Layer, stage: StageApi): TaskGen {
  const text = layer.kind === "text" ? layer.text : "";
  yield* agent.moveTo(layer.box.x, layer.box.y);
  agent.setCursor("ibeam");
  agent.say("typing");
  for (let i = 1; i <= text.length; i++) {
    stage.reveal(layer.id, i / text.length);
    agent.sound("key");
    yield 30;
  }
  stage.finish(layer.id);
}

export const testPlugin: Plugin = { name: "test", tasks: { box: boxTask, text: textTask } };

export const theme: ResolvedTheme = {
  palette: ["#5B5BF7", "#14B8A6", "#F5A524", "#E0457B"],
  accent: "#14B8A6",
  select: "#5B5BF7",
  chrome: "light",
  scheme: "light",
};

export function blueprintOf(layers: Layer[], size = { w: 800, h: 1200 }): Blueprint {
  return { version: 1, source: { type: "test" }, size, background: "#fff", layers };
}

export function box(id: string, x: number, y: number, w = 120, h = 60, extra: Partial<Layer> = {}): Layer {
  return { id, kind: "box", box: { x, y, w, h }, style: {}, ...extra } as Layer;
}

export function text(id: string, x: number, y: number, body: string, extra: Partial<Layer> = {}): Layer {
  return { id, kind: "text", box: { x, y, w: 200, h: 24 }, html: body, text: body, style: {}, ...extra } as Layer;
}

export function guide(id: string, pos: number): Layer {
  return { id, kind: "guide", axis: "x", pos, box: { x: pos, y: 0, w: 1, h: 600 } } as Layer;
}

/** A page of sections with nested boxes, text, a guide and a duplicate. */
export function samplePage(): Blueprint {
  return blueprintOf([
    box("hero", 20, 20, 760, 300),
    text("title", 60, 60, "Hello loom", { parent: "hero", snaps: ["g1"] }),
    guide("g1", 60),
    box("card1", 60, 140, 200, 140, { parent: "hero" }),
    box("card2", 300, 140, 200, 140, { parent: "hero", master: "card1" }),
    box("footer", 20, 700, 760, 200),
    text("note", 40, 720, "Made by hand", { parent: "footer" }),
  ]);
}

export const baseSettings: EngineSettings = {
  agents: 6,
  speed: 1,
  seed: 7,
  labels: "names",
  follow: "scroll",
  finale: "flock",
  intro: true,
  reducedMotion: false,
};

export interface Harness {
  engine: Engine;
  stage: FakeStage;
  sound: FakeSound;
  clock: VirtualClock;
  /** Advances `frames` frames of `ms` each (default 60 Hz). */
  run(frames: number, ms?: number): void;
  /** Advances until `pred` holds or `maxMs` of clock time passed; returns the elapsed ms. */
  until(pred: () => boolean, maxMs?: number, ms?: number): number;
}

export function harness(
  blueprint: Blueprint = samplePage(),
  settings: Partial<EngineSettings> = {},
  deps: Partial<EngineDeps> = {},
): Harness {
  const stage = new FakeStage(blueprint);
  const sound = new FakeSound();
  const clock = new VirtualClock();
  const engine = new Engine({
    stage,
    sound,
    clock,
    ownsClock: false,
    plugins: [testPlugin],
    estimate: () => 500,
    theme,
    translate: (key) => key,
    settings: { ...baseSettings, ...settings },
    liveLevels: false,
    initialScroll: 0,
    ...deps,
  });
  clock.start();
  const run = (frames: number, ms = 1000 / 60): void => {
    for (let i = 0; i < frames; i++) clock.advance(ms);
  };
  const until = (pred: () => boolean, maxMs = 120_000, ms = 1000 / 60): number => {
    let elapsed = 0;
    while (!pred() && elapsed < maxMs) {
      clock.advance(ms);
      elapsed += ms;
    }
    return elapsed;
  };
  return { engine, stage, sound, clock, run, until };
}
