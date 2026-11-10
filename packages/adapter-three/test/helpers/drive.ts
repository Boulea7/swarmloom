import {
  type AgentApi,
  type CustomLayer,
  createRng,
  type Layer,
  type LoadedSource,
  type OverlayHandle,
  type Plugin,
  type Point,
  type SoundName,
  type StageApi,
  type TaskGen,
} from "@swarmloom/core";

/** What a simulated build observed. */
export interface DriveReport {
  /** Every moveTo/dragTo target, stage px. */
  targets: Point[];
  sounds: SoundName[];
  /** Overlays still open at the end (must be 0). */
  openOverlays: number;
  finished: Set<string>;
  /** Engine ms the build took. */
  elapsed: number;
}

/** A minimal StageApi delegating custom layers to the plugin's renderers, like the real stage. */
export function fakeStage(source: LoadedSource, plugin: Plugin, finished: Set<string>) {
  const { blueprint } = source;
  const byId = new Map(blueprint.layers.map((l) => [l.id, l]));
  let open = 0;
  const renderer = (id: string) => {
    const layer = byId.get(id) as CustomLayer | undefined;
    return layer ? { layer, r: plugin.renderers?.[layer.task] } : null;
  };
  const stage: StageApi = {
    blueprint,
    layer: (id) => byId.get(id),
    el: () => null,
    reveal(id, p) {
      const hit = renderer(id);
      hit?.r?.reveal(hit.layer, p);
    },
    finish(id) {
      const hit = renderer(id);
      hit?.r?.finish?.(hit.layer);
      finished.add(id);
    },
    setStyle() {},
    overlay(): OverlayHandle {
      open++;
      let removed = false;
      return {
        update() {},
        remove() {
          if (!removed) open--;
          removed = true;
        },
      };
    },
    viewport: () => ({ x: 0, y: 0, w: blueprint.size.w, h: blueprint.size.h }),
    caretAt: () => ({ x: 0, y: 0 }),
  };
  for (const layer of blueprint.layers) {
    const hit = renderer(layer.id);
    hit?.r?.mount(hit.layer, document.createElement("div"), stage);
  }
  return { stage, openOverlays: () => open };
}

function fakeAgent(id: number, targets: Point[], sounds: SoundName[]): AgentApi {
  const rng = createRng(1000 + id);
  const agent = {
    id,
    name: `Agent ${id}`,
    color: ["#5B5BF7", "#FF6B5B", "#14B8A6", "#F5A524"][id % 4] as string,
    x: 0,
    y: 0,
    rng,
    *moveTo(x: number, y: number, opts?: { dur?: number }): TaskGen {
      targets.push({ x, y });
      const steps = 3;
      const x0 = agent.x;
      const y0 = agent.y;
      for (let i = 1; i <= steps; i++) {
        agent.x = x0 + ((x - x0) * i) / steps;
        agent.y = y0 + ((y - y0) * i) / steps;
        yield (opts?.dur ?? 300) / steps;
      }
    },
    dragTo(x: number, y: number, opts?: { dur?: number }): TaskGen {
      return agent.moveTo(x, y, opts);
    },
    press() {},
    release() {},
    setCursor() {},
    say() {},
    sound(name: SoundName) {
      sounds.push(name);
    },
  };
  return agent;
}

/**
 * Simulates the engine: `agents` cursors pick the next layer whose parent is finished (in
 * blueprint order) and run its task; engine time advances in 16 ms steps and every
 * `frameMs` of engine time calls `plugin.frame` (software GL is slow: tests render sparsely).
 * Throws if the build does not finish within `limitMs`.
 */
export function driveBuild(source: LoadedSource, agents = 4, frameMs = 16, limitMs = 600_000): DriveReport {
  const plugin = source.plugins?.[0] as Plugin;
  const finished = new Set<string>();
  const { stage, openOverlays } = fakeStage(source, plugin, finished);
  const targets: Point[] = [];
  const sounds: SoundName[] = [];
  const queue: Layer[] = [...source.blueprint.layers];
  const workers = Array.from({ length: agents }, (_, i) => ({
    agent: fakeAgent(i, targets, sounds),
    task: null as TaskGen | null,
    wakeAt: 0,
  }));
  let now = 0;
  let lastFrame = 0;
  while (queue.length > 0 || workers.some((w) => w.task)) {
    for (const w of workers) {
      if (!w.task) {
        const index = queue.findIndex((l) => !l.parent || finished.has(l.parent));
        if (index < 0) continue;
        const layer = queue.splice(index, 1)[0] as CustomLayer;
        const fn = plugin.tasks?.[layer.task];
        if (!fn) throw new Error(`no task for ${layer.task}`);
        w.task = fn(w.agent, layer, stage);
        w.wakeAt = now;
      }
      while (w.task && w.wakeAt <= now) {
        const r = w.task.next();
        if (r.done) w.task = null;
        else w.wakeAt = now + (typeof r.value === "number" ? r.value : 16);
      }
    }
    now += 16;
    if (now - lastFrame >= frameMs) {
      plugin.frame?.(now, now - lastFrame);
      lastFrame = now;
    }
    if (now > limitMs) throw new Error(`build did not finish within ${limitMs} ms`);
  }
  return { targets, sounds, openOverlays: openOverlays(), finished, elapsed: now };
}
