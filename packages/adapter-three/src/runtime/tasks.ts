import type { AgentApi, CustomLayer, OverlayHandle, Point, StageApi, TaskFn, TaskGen } from "@swarmloom/core";
import type { EdgesData, LightData, MaterialData, PatchData, PointsData } from "../plan/layers";
import { TASK } from "../plan/layers";
import { CHANNEL } from "../plan/state";
import type { ModelScene } from "./scene";

/** Longest a material or light task waits for other cursors before going ahead, engine ms. */
const BARRIER_MS = 12_000;
const BARRIER_STEP_MS = 80;

/** Maps a build-time stage point to its current screen point (identity while the camera is locked). */
export type PointMapper = (p: Point) => Point;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function patchOf(layer: CustomLayer): number {
  const data = layer.data;
  return isRecord(data) && Number.isInteger(data.patch) ? (data.patch as number) : -1;
}

function points(value: unknown): Point[] {
  return Array.isArray(value) ? value.filter(isPoint) : [];
}

function centre(layer: CustomLayer): Point {
  return { x: layer.box.x + layer.box.w / 2, y: layer.box.y + layer.box.h / 2 };
}

/** Runs `inner` and calls `step` after every one of its steps (the agent has moved). */
function* driven(inner: TaskGen, step: () => void): TaskGen {
  let resume: unknown;
  for (;;) {
    const r = inner.next(resume);
    step();
    if (r.done) return;
    resume = yield r.value;
  }
}

/** Fraction 0..1 of the agent's progress along the segment a -> b. */
function along(agent: AgentApi, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return 1;
  return Math.min(1, Math.max(0, ((agent.x - a.x) * dx + (agent.y - a.y) * dy) / len2));
}

/** Duration with a small deterministic jitter from the agent's rng. */
function jitter(agent: AgentApi, ms: number, spread = 0.25): number {
  return Math.round(ms * (1 - spread / 2 + agent.rng() * spread));
}

function removeAll(handles: Array<OverlayHandle | null>): void {
  for (const h of handles) h?.remove();
}

/**
 * Creates the choreographies of the five 3D task kinds. Every task reveals through
 * `stage.reveal`/`stage.finish` (which delegate to the plugin's renderers), removes its
 * overlays in `finally`, and only waits on engine time.
 */
export function createTasks(scene: ModelScene, map: PointMapper): Record<string, TaskFn<CustomLayer>> {
  /** Vertices: tap each chunk in; the tapped chunk pops onto the surface. */
  function* pointsTask(agent: AgentApi, layer: CustomLayer, stage: StageApi): TaskGen {
    const patch = patchOf(layer);
    const data = layer.data as Partial<PointsData> | undefined;
    const taps = points(data?.taps);
    if (taps.length === 0) taps.push(centre(layer));
    scene.markStarted(patch);
    scene.tint(CHANNEL.points, patch, agent.color);
    agent.setCursor("crosshair");
    try {
      for (let i = 0; i < taps.length; i++) {
        const tap = map(taps[i] as Point);
        yield* agent.moveTo(tap.x, tap.y, { dur: jitter(agent, i === 0 ? 380 : 200), ease: "out" });
        agent.press();
        scene.hint(CHANNEL.points, patch, { chunk: true, spreadMs: 160 });
        stage.reveal(layer.id, (i + 1) / taps.length);
        agent.sound("pop", { vel: 0.3 });
        yield 60;
        agent.release();
        yield jitter(agent, 40);
      }
    } finally {
      agent.setCursor("arrow");
    }
    stage.finish(layer.id);
  }

  /** Edges: pull a representative edge per chunk with the pen; edges grow while dragging. */
  function* edgesTask(agent: AgentApi, layer: CustomLayer, stage: StageApi): TaskGen {
    const patch = patchOf(layer);
    const data = layer.data as Partial<EdgesData> | undefined;
    const strokes = Array.isArray(data?.strokes)
      ? data.strokes.filter((s): s is [Point, Point] => Array.isArray(s) && isPoint(s[0]) && isPoint(s[1]))
      : [];
    scene.markStarted(patch);
    scene.tint(CHANNEL.edges, patch, agent.color);
    agent.setCursor("pen");
    const handles: Array<OverlayHandle | null> = [null, null];
    try {
      for (let i = 0; i < strokes.length; i++) {
        const [rawA, rawB] = strokes[i] as [Point, Point];
        const a = map(rawA);
        const b = map(rawB);
        const from = i / strokes.length;
        const to = (i + 1) / strokes.length;
        yield* agent.moveTo(a.x, a.y, { dur: jitter(agent, i === 0 ? 380 : 220) });
        handles[0] = stage.overlay("anchor", { x: a.x, y: a.y, color: agent.color, active: true });
        handles[1] = stage.overlay("rubber-band", { x1: a.x, y1: a.y, x2: a.x, y2: a.y, color: agent.color });
        agent.press();
        agent.sound("pen");
        const band = handles[1];
        yield* driven(agent.dragTo(b.x, b.y, { dur: jitter(agent, 340), ease: "inOut" }), () => {
          band.update({ x1: a.x, y1: a.y, x2: agent.x, y2: agent.y, color: agent.color });
          stage.reveal(layer.id, from + (to - from) * along(agent, a, b));
        });
        stage.reveal(layer.id, to);
        agent.release();
        removeAll(handles);
        handles[0] = null;
        handles[1] = null;
        yield jitter(agent, 50);
      }
    } finally {
      removeAll(handles);
      agent.setCursor("arrow");
    }
    stage.finish(layer.id);
  }

  /** Faces: drag a zig-zag across the patch; triangles grow in along the sweep. */
  function* patchTask(agent: AgentApi, layer: CustomLayer, stage: StageApi): TaskGen {
    const patch = patchOf(layer);
    const data = layer.data as Partial<PatchData> | undefined;
    const sweep = Array.isArray(data?.sweep)
      ? data.sweep.filter((w): w is Point & { p: number } => isPoint(w) && Number.isFinite((w as { p?: unknown }).p))
      : [];
    if (sweep.length === 0) sweep.push({ ...centre(layer), p: 0 }, { ...centre(layer), p: 1 });
    const weight = Number.isFinite(data?.weight) ? (data?.weight as number) : 0.5;
    scene.markStarted(patch);
    scene.tint(CHANNEL.faces, patch, agent.color);
    let selection: OverlayHandle | null = null;
    try {
      const start = map(sweep[0] as Point);
      yield* agent.moveTo(start.x, start.y, { dur: jitter(agent, 360) });
      const box = layer.box;
      const tl = map({ x: box.x, y: box.y });
      const br = map({ x: box.x + box.w, y: box.y + box.h });
      selection = stage.overlay("selection", {
        x: Math.min(tl.x, br.x),
        y: Math.min(tl.y, br.y),
        w: Math.abs(br.x - tl.x),
        h: Math.abs(br.y - tl.y),
        color: agent.color,
        handles: false,
      });
      agent.setCursor("grab");
      agent.press();
      for (let i = 1; i < sweep.length; i++) {
        const prev = sweep[i - 1] as Point & { p: number };
        const next = sweep[i] as Point & { p: number };
        const a = map(prev);
        const b = map(next);
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const dur = Math.max(100, Math.min(700, dist * 3.2));
        yield* driven(agent.dragTo(b.x, b.y, { dur: jitter(agent, dur, 0.2), ease: i === 1 ? "in" : "linear" }), () => {
          stage.reveal(layer.id, prev.p + (next.p - prev.p) * along(agent, a, b));
        });
      }
      agent.release();
      agent.sound("note", { pitch: 1 - Math.min(1, Math.max(0, weight)), vel: 0.55 });
    } finally {
      selection?.remove();
      agent.setCursor("arrow");
    }
    stage.finish(layer.id);
  }

  /** Materials: wait for this group's patches, then drag a short slider while clay turns into material. */
  function* materialTask(agent: AgentApi, layer: CustomLayer, stage: StageApi): TaskGen {
    const data = layer.data as Partial<MaterialData> | undefined;
    const patches = Array.isArray(data?.patches) ? data.patches.filter((p): p is number => Number.isInteger(p)) : [];
    const anchor = map(isPoint(data?.anchor) ? data.anchor : centre(layer));
    const name = typeof data?.name === "string" ? data.name : "";
    yield* agent.moveTo(anchor.x, anchor.y, { dur: jitter(agent, 420) });
    for (let waited = 0; waited < BARRIER_MS && scene.pending(patches); waited += BARRIER_STEP_MS) {
      yield BARRIER_STEP_MS;
    }
    const slide = Math.min(90, Math.max(40, layer.box.w * 0.3));
    const a = { x: anchor.x - slide / 2, y: anchor.y };
    const b = { x: anchor.x + slide / 2, y: anchor.y };
    let badge: OverlayHandle | null = null;
    try {
      yield* agent.moveTo(a.x, a.y, { dur: 200 });
      agent.setCursor("resize");
      if (name) agent.say(name);
      badge = stage.overlay("size-badge", { x: a.x, y: a.y, text: "0%", color: agent.color });
      agent.press();
      const handle = badge;
      yield* driven(agent.dragTo(b.x, b.y, { dur: jitter(agent, 900, 0.15), ease: "inOut" }), () => {
        const p = along(agent, a, b);
        stage.reveal(layer.id, p);
        handle.update({ x: agent.x, y: agent.y, text: `${Math.round(p * 100)}%`, color: agent.color });
      });
      agent.release();
      agent.sound("note", { pitch: 0.35, vel: 0.4 });
    } finally {
      badge?.remove();
      agent.say("");
      agent.setCursor("arrow");
    }
    stage.finish(layer.id);
  }

  /** Light: wait for every cursor, then sweep a key light across the model. */
  function* lightTask(agent: AgentApi, layer: CustomLayer, stage: StageApi): TaskGen {
    const data = layer.data as Partial<LightData> | undefined;
    const box = layer.box;
    const from = map(isPoint(data?.from) ? data.from : { x: box.x, y: box.y + box.h * 0.3 });
    const to = map(isPoint(data?.to) ? data.to : { x: box.x + box.w, y: box.y + box.h * 0.55 });
    const all = Array.from({ length: scene.state.patches }, (_, i) => i);
    yield* agent.moveTo(from.x, from.y, { dur: jitter(agent, 480) });
    for (
      let waited = 0;
      waited < BARRIER_MS && (scene.pending(all) || scene.materialsPending());
      waited += BARRIER_STEP_MS
    ) {
      yield BARRIER_STEP_MS;
    }
    try {
      agent.setCursor("hand");
      agent.press();
      agent.sound("sweep", { vel: 0.5 });
      yield* driven(agent.dragTo(to.x, to.y, { dur: jitter(agent, 1500, 0.1), ease: "inOut" }), () => {
        stage.reveal(layer.id, along(agent, from, to));
      });
      agent.release();
    } finally {
      agent.setCursor("arrow");
    }
    stage.finish(layer.id);
  }

  return {
    [TASK.points]: pointsTask,
    [TASK.edges]: edgesTask,
    [TASK.patch]: patchTask,
    [TASK.material]: materialTask,
    [TASK.light]: lightTask,
  };
}
