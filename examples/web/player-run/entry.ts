/**
 * Page-side half of the player run harness (see ../README.md, "Player run"). Bundled by
 * run.mjs and injected into examples/web/demo.html; exposes `window.__swl`.
 *
 * It snapshots the page with the dom adapter, plays it with the real createPlayer and records
 * build timings from the stage's finish calls: when every layer of the first screen is done,
 * when the build completes, and how long layers outside the viewport were being worked on.
 */
import { createPlayer, type Layer, type Player, type Plugin, type Rect, VirtualClock } from "@swarmloom/core";
import { domAdapter } from "@swarmloom/snapshot-dom";

interface StartOptions {
  follow?: "scroll" | "tour" | "none";
  realtime?: boolean;
  seed?: number;
  /** Show the toolbar's seek bar (PlayerOptions.scrubber). */
  scrubber?: boolean;
}

interface Metrics {
  layers: number;
  firstScreenLayers: number;
  /** Player ms when every layer of the first screen was finished (null: not yet). */
  firstScreenAt: number | null;
  /** Player ms of the "finale" state (build complete). */
  builtAt: number | null;
  doneAt: number | null;
  /** Player ms of building frames in which a layer outside the viewport was partly revealed. */
  outOfSightMs: number;
  /** Player.eta() at the end of each advance() call, ms (how well the toolbar's ETA predicts). */
  eta: number[];
  state: string;
  elapsed: number;
}

const FRAME_MS = 1000 / 60;

let player: Player | null = null;
let clock: VirtualClock | null = null;
let elapsed = 0;
let started = 0;
const firstScreen = new Set<string>();
const metrics: Metrics = {
  layers: 0,
  firstScreenLayers: 0,
  firstScreenAt: null,
  builtAt: null,
  doneAt: null,
  outOfSightMs: 0,
  eta: [],
  state: "none",
  elapsed: 0,
};

function now(): number {
  return clock ? elapsed : performance.now() - started;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function visibleRect(layer: Layer): Rect | null {
  const { box, clip } = layer;
  if (!(box.w > 0 && box.h > 0)) return null;
  if (!clip) return box;
  const x = Math.max(box.x, clip.x);
  const y = Math.max(box.y, clip.y);
  const r = Math.min(box.x + box.w, clip.x + clip.w);
  const b = Math.min(box.y + box.h, clip.y + clip.h);
  return r > x && b > y ? { x, y, w: r - x, h: b - y } : null;
}

/** Set when a layer outside the viewport was partly revealed since the last sample. */
let hiddenWork = false;

/**
 * Wraps the stage's finish() to time the first screen and reveal() to notice work nobody can
 * see (the plugin's setup gets the real stage object).
 */
const probe: Plugin = {
  name: "swl-e2e-probe",
  setup(stage) {
    const finish = stage.finish.bind(stage);
    const reveal = stage.reveal.bind(stage);
    stage.finish = (id: string) => {
      finish(id);
      if (firstScreen.delete(id) && firstScreen.size === 0 && metrics.firstScreenAt === null) {
        metrics.firstScreenAt = now();
      }
    };
    stage.reveal = (id: string, p: number) => {
      reveal(id, p);
      const layer = stage.layer(id);
      const r = layer && layer.kind !== "guide" ? visibleRect(layer) : null;
      if (p < 1 && r && !intersects(r, stage.viewport())) hiddenWork = true;
    };
  },
};

function sample(dt: number): void {
  if (hiddenWork && player?.state === "building") metrics.outOfSightMs += dt;
  hiddenWork = false;
}

(window as unknown as Record<string, unknown>).__swl = {
  async start(opts: StartOptions = {}): Promise<number> {
    const loaded = await domAdapter.load(
      { element: document.documentElement, name: "demo.html" },
      { document, width: innerWidth, theme: "light" },
    );
    const screen: Rect = { x: 0, y: 0, w: innerWidth, h: innerHeight };
    for (const layer of loaded.blueprint.layers) {
      const r = visibleRect(layer);
      if (layer.kind !== "guide" && r && intersects(r, screen)) firstScreen.add(layer.id);
    }
    metrics.layers = loaded.blueprint.layers.length;
    metrics.firstScreenLayers = firstScreen.size;
    clock = opts.realtime ? null : new VirtualClock();
    player = createPlayer({
      blueprint: loaded.blueprint,
      plugins: [...(loaded.plugins ?? []), probe],
      ...(clock ? { clock } : {}),
      seed: opts.seed ?? 7,
      sound: false,
      follow: opts.follow ?? "scroll",
      scrubber: opts.scrubber === true,
    });
    player.on("state", ({ state }) => {
      if (state === "finale" && metrics.builtAt === null) metrics.builtAt = now();
      if (state === "done" && metrics.doneAt === null) metrics.doneAt = now();
    });
    started = performance.now();
    if (!clock) {
      let last = started;
      const loop = (t: number): void => {
        sample(t - last);
        last = t;
        if (player && player.state !== "done" && player.state !== "destroyed") requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    void player.play();
    return metrics.layers;
  },
  /** Advances the virtual clock by `ms` in 60 Hz frames (stops early once done). */
  advance(ms: number): string {
    for (let t = 0; t < ms && clock && player && player.state !== "done"; t += FRAME_MS) {
      clock.advance(FRAME_MS);
      elapsed += FRAME_MS;
      sample(FRAME_MS);
    }
    if (player) metrics.eta.push(Math.round(player.eta()));
    return player?.state ?? "none";
  },
  /** Seeks to `t` player ms and returns how long the seek blocked the page, in wall-clock ms. */
  seek(t: number): number {
    const before = performance.now();
    player?.seek?.(t);
    return performance.now() - before;
  },
  metrics(): Metrics {
    return { ...metrics, state: player?.state ?? "none", elapsed: now() };
  },
};
