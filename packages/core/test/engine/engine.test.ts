import { describe, expect, it } from "vitest";
import { builtinPlugin, choreoHelpers } from "../../src/choreo/index";
import { FINALE_SETTLE_MS, IDLE_RUSH_MS } from "../../src/engine/constants";
import type { EngineSettings } from "../../src/engine/engine";
import { autoAgentCount, type FollowMode } from "../../src/engine/options";
import type { AgentApi, Layer, PlayerState, Plugin, Rect, StageApi, TaskFn, TaskGen } from "../../src/types";
import { blueprintOf, box, harness, samplePage, testPlugin, text } from "./fakes";

/** Plays to the finale and returns the frame trace hash and a copy of the sound log. */
function trace(settings: Partial<EngineSettings>) {
  const h = harness(samplePage(), settings);
  void h.engine.play();
  h.until(() => h.engine.state === "finale");
  h.run(30);
  return { hash: h.stage.hash.value, log: h.engine.soundLog.map((e) => ({ ...e })), h };
}

function states(h: ReturnType<typeof harness>): PlayerState[] {
  const seen: PlayerState[] = [];
  h.engine.on("state", (e) => seen.push(e.state));
  return seen;
}

describe("Engine", () => {
  it("is deterministic: same seed gives the same frames and sound log, another seed differs", () => {
    const a = trace({ seed: 7 });
    const b = trace({ seed: 7 });
    const c = trace({ seed: 8 });
    expect(a.log.length).toBeGreaterThan(20);
    expect(b.hash).toBe(a.hash);
    expect(b.log).toEqual(a.log);
    expect(c.hash).not.toBe(a.hash);
    // Every layer was built, its overlays removed, and the sound engine got what was logged.
    expect(a.h.stage.finished).toHaveLength(7);
    expect(a.h.stage.live("ghost-rect")).toHaveLength(0);
    expect(a.h.stage.live("icon")).toHaveLength(0);
    expect(a.h.sound.played).toEqual(a.h.engine.soundLog);
    expect(a.log.map((e) => e.name)).toEqual(expect.arrayContaining(["swell", "fanout", "key", "note", "chord"]));
  });

  it("opens every tick with the stage's read phase and names a task's layer before the task writes", () => {
    const h = harness(samplePage(), { seed: 7 });
    const log: string[] = [];
    const reveal = h.stage.reveal.bind(h.stage);
    Object.assign(h.stage, {
      measure: () => log.push("read"),
      prefetch: (id: string) => log.push(`prefetch:${id}`),
      reveal: (id: string, p: number) => {
        log.push(`reveal:${id}`);
        reveal(id, p);
      },
    });
    h.clock.onTick(() => log.push("tick"));
    void h.engine.play();
    h.until(() => h.engine.state === "finale");
    // Within a tick nothing is written before the read phase.
    expect(log.join(" ")).not.toMatch(/tick (reveal|prefetch)/);
    // Layers built by a task (the rest fades in out of sight without one) are named first.
    const named = log.filter((e) => e.startsWith("prefetch:")).map((e) => e.slice(9));
    expect(named.length).toBeGreaterThan(3);
    for (const id of named) expect(log.indexOf(`prefetch:${id}`), id).toBeLessThan(log.indexOf(`reveal:${id}`));
  });

  it("replay resets the stage and reproduces the run exactly", () => {
    const first = trace({ seed: 3 });
    const { h } = first;
    h.engine.replay();
    expect(h.stage.calls.reset).toBe(1);
    expect(h.engine.state).toBe("intro");
    expect(h.engine.progress.built).toBe(0);
    h.until(() => h.engine.state === "finale");
    h.run(30);
    expect(h.engine.soundLog).toEqual(first.log);
    expect(h.stage.hash.value).toBe(first.hash);
  });

  it("replay mid-build reproduces a tour run (no in-sight state leaks into the new run)", () => {
    const page = blueprintOf(
      Array.from({ length: 12 }, (_, i) => box(`b${i}`, 40, 40 + i * 260, 300, 200)),
      { w: 800, h: 3160 },
    );
    const finish = (h: ReturnType<typeof harness>) => {
      h.until(() => h.engine.state === "finale");
      h.run(30);
      return { hash: h.stage.hash.value, log: h.engine.soundLog.map((e) => ({ ...e })) };
    };
    const fresh = harness(page, { follow: "tour", seed: 5 });
    void fresh.engine.play();
    const expected = finish(fresh);
    const h = harness(page, { follow: "tour", seed: 5 });
    void h.engine.play();
    h.run(200);
    h.engine.replay();
    const replayed = finish(h);
    expect(replayed.log).toEqual(expected.log);
    expect(replayed.hash).toBe(expected.hash);
  });

  it("fades the intro icon out from its current alpha after fan-out, then removes it", () => {
    const h = harness(samplePage(), { seed: 7 });
    void h.engine.play();
    h.run(6);
    const icon = h.stage.live("icon")[0];
    h.stage.userScroll(40); // an early user scroll fans the crew out while the icon fades in
    h.run(1);
    expect(h.engine.state).toBe("building");
    const atFanOut = icon?.props.alpha as number;
    expect(atFanOut).toBeLessThan(1);
    h.run(1);
    expect(icon?.props.alpha).toBeLessThan(atFanOut);
    h.run(30);
    expect(h.stage.live("icon")).toHaveLength(0);
  });

  it("pause freezes time, resume continues and speed shortens the build", async () => {
    const timeToFinale = (speed: number): number => {
      const h = harness(samplePage(), { speed, intro: false });
      void h.engine.play();
      return h.until(() => h.engine.state === "finale");
    };
    const t1 = timeToFinale(1);
    const t2 = timeToFinale(2);
    expect(t2 / t1).toBeGreaterThan(0.4);
    expect(t2 / t1).toBeLessThan(0.65);

    const h = harness(samplePage(), { intro: false });
    const done = h.engine.play();
    h.run(40);
    h.engine.pause();
    expect(h.engine.state).toBe("paused");
    const logged = h.engine.soundLog.length;
    const hash = h.stage.hash.value;
    const built = h.engine.progress.built;
    h.run(600);
    expect(h.engine.soundLog.length).toBe(logged);
    expect(h.engine.progress.built).toBe(built);
    // Frames are still drawn while paused, but nothing moves.
    expect(h.stage.hash.value).not.toBe(hash);
    h.engine.resume();
    expect(h.engine.state).toBe("building");
    h.until(() => h.engine.state === "finale");
    await expect(done).resolves.toBeUndefined();
    expect(() => h.engine.setSpeed(0)).toThrow(RangeError);
  });

  it("reports a speed, sound or follow change with the current values, and nothing when unchanged", () => {
    const h = harness();
    const seen: unknown[] = [];
    h.engine.on("settings", ({ type: _, ...rest }) => seen.push(rest));
    h.engine.setSpeed(2);
    h.engine.setSpeed(2);
    h.engine.setSound(false);
    h.engine.setFollow("tour");
    h.engine.setFollow("tour");
    expect(seen).toEqual([
      { speed: 2, sound: true, follow: "scroll" },
      { speed: 2, sound: false, follow: "scroll" },
      { speed: 2, sound: false, follow: "tour" },
    ]);
  });

  it("runs the finale, switches between flock, halo and none, then settles to done", () => {
    const h = harness(samplePage(), { intro: false, agents: 10 });
    const seen = states(h);
    void h.engine.play();
    h.until(() => h.engine.state === "finale");
    h.run(30);
    expect(h.stage.drawn.at(-1)).toBe(7); // finale crew = 70% of 10
    h.engine.setFinale("halo");
    expect(h.stage.live("halo")).toHaveLength(1);
    h.run(240);
    const halo = h.stage.live("halo")[0]?.props as { x: number; y: number; r: number };
    expect(halo.r).toBeGreaterThan(100);
    h.engine.setFinale("none");
    expect(h.stage.live("halo")).toHaveLength(0);
    h.run(90);
    expect(h.stage.drawn.at(-1)).toBe(0);
    h.engine.setFinale("flock");
    h.run(120);
    expect(h.stage.drawn.at(-1)).toBe(7);
    h.run(Math.ceil(FINALE_SETTLE_MS / 16));
    expect(seen).toEqual(["building", "finale", "done"]);
    expect(() => h.engine.setFinale("spin" as "flock")).toThrow(RangeError);
  });

  it("flocks around the pointer without entering its keep-out circle", () => {
    const h = harness(samplePage(), { intro: false, agents: 12 });
    void h.engine.play();
    h.until(() => h.engine.state === "finale");
    h.stage.pointerAt = { x: 400, y: 300 };
    const views: { x: number; y: number }[] = [];
    const render = h.stage.render.bind(h.stage);
    h.stage.render = (now, agents) => {
      views.length = 0;
      for (const a of agents) views.push({ x: a.x, y: a.y });
      render(now, agents);
    };
    h.run(300);
    const dists = views.map((v) => Math.hypot(v.x - 400, v.y - 300));
    expect(Math.min(...dists)).toBeGreaterThanOrEqual(47.9);
    expect(Math.max(...dists)).toBeLessThan(260);
  });

  it("tour scrolls at build pace without passing unfinished work; fast user scrolls call more agents", () => {
    const tall = (): ReturnType<typeof blueprintOf> =>
      blueprintOf(
        Array.from({ length: 48 }, (_, i) => box(`r${i}`, (i % 2) * 400, Math.floor(i / 2) * 150, 300, 100)),
        { w: 800, h: 3600 },
      );
    const h = harness(tall(), { intro: false, follow: "tour", agents: 8 });
    const tops = new Map(h.stage.blueprint.layers.map((l) => [l.id, l.box.y]));
    let maxScroll = 0;
    let violations = 0;
    void h.engine.play();
    h.until(() => {
      const done = new Set(h.stage.finished);
      let frontier = Number.POSITIVE_INFINITY;
      for (const [id, y] of tops) if (!done.has(id)) frontier = Math.min(frontier, y);
      if (Number.isFinite(frontier) && h.stage.scrollY > Math.max(0, frontier - 0.3 * 600) + 1) violations++;
      maxScroll = Math.max(maxScroll, h.stage.scrollY);
      return h.engine.state === "finale";
    });
    expect(h.engine.state).toBe("finale");
    expect(violations).toBe(0);
    expect(maxScroll).toBeGreaterThan(2500);

    const crew = (scroll: boolean): number => {
      const s = harness(tall(), { intro: false, agents: 24 });
      void s.engine.play();
      s.run(90); // the base crew (half the pool) walks in first
      for (let f = 0; f < 60; f++) {
        if (scroll) s.stage.userScroll((f + 1) * 40);
        s.run(1);
      }
      return Math.max(...s.stage.drawn);
    };
    expect(crew(true)).toBeGreaterThan(crew(false));
  });

  it("never builds out of sight: unscrolled, the rest fades in shortly after the screen is built", () => {
    const tall = blueprintOf(
      Array.from({ length: 40 }, (_, i) => box(`r${i}`, (i % 2) * 400, Math.floor(i / 2) * 150, 300, 100)),
      { w: 800, h: 3000 },
    );
    const started: { id: string; y: number; top: number; bottom: number }[] = [];
    const build = testPlugin.tasks?.box as TaskFn;
    const watch: Plugin = {
      name: "watch",
      tasks: {
        box: (agent: AgentApi, layer: Layer, stage: StageApi): TaskGen => {
          const vp = stage.viewport();
          started.push({ id: layer.id, y: layer.box.y, top: vp.y, bottom: vp.y + vp.h });
          return build(agent, layer, stage);
        },
      },
    };
    const h = harness(tall, { intro: false, agents: 8 }, { plugins: [testPlugin, watch] });
    void h.engine.play();
    const onScreen = h.stage.blueprint.layers.filter((l) => l.box.y < 600);
    let now = 0;
    let screenDoneAt = Number.NaN;
    const ms = h.until(() => {
      if (Number.isNaN(screenDoneAt) && onScreen.every((l) => h.stage.finished.includes(l.id))) screenDoneAt = now;
      now += 1000 / 60;
      return h.engine.state === "finale";
    });
    // Cursors only took layers that were (at least partly) in view when they started.
    expect(started.length).toBeGreaterThan(0);
    expect(started.filter((s) => s.y + 100 < s.top || s.y > s.bottom)).toEqual([]);
    expect(h.engine.progress).toEqual({ built: 40, total: 40 });
    // The out-of-sight rest is a short cursor-free fill, not cursors working below the fold.
    expect(ms - screenDoneAt).toBeLessThan(IDLE_RUSH_MS + 1500);
  });

  it("sizes the crew from work in sight, not from work waiting out of sight", () => {
    const top = (): Layer[] => [0, 1, 2, 3].map((i) => box(`t${i}`, 20 + i * 190, 40, 160, 120));
    const below = (y0: number): Layer[] =>
      Array.from({ length: 80 }, (_, i) => box(`b${i}`, (i % 10) * 78, y0 + Math.floor(i / 10) * 30, 60, 20));
    // Most cursors drawn while the four layers in view are built.
    const crew = (layers: Layer[], follow: FollowMode): number => {
      const h = harness(blueprintOf(layers, { w: 800, h: 3000 }), { intro: false, agents: 20, follow });
      void h.engine.play();
      h.until(() => ["t0", "t1", "t2", "t3"].every((id) => h.stage.finished.includes(id)));
      expect(h.stage.scrollY).toBe(0);
      return Math.max(...h.stage.drawn);
    };
    for (const [follow, y0] of [
      ["none", 650],
      ["scroll", 650],
      ["none", 2000],
    ] as const) {
      expect(crew([...top(), ...below(y0)], follow)).toBe(crew(top(), follow));
    }
  });

  it("reduced motion cross-fades layers in plan order without cursors", () => {
    const h = harness(samplePage(), { reducedMotion: true });
    void h.engine.play();
    const ms = h.until(() => h.engine.state === "finale");
    expect(ms).toBeLessThan(3500);
    expect(Math.max(...h.stage.drawn)).toBe(0);
    const order = h.stage.finished;
    expect(order.indexOf("hero")).toBeLessThan(order.indexOf("card1"));
    expect(order.indexOf("card1")).toBeLessThan(order.indexOf("card2"));
    expect(order.indexOf("g1")).toBeLessThan(order.indexOf("title"));
  });

  it("degrades a failing layer, reports it and still completes the build", () => {
    function* broken(): TaskGen {
      yield 10;
      throw new Error("boom");
    }
    function* weird(agent: AgentApi, layer: Layer, stage: StageApi): TaskGen {
      yield "soon" as unknown as number;
      yield* testPlugin.tasks?.text?.(agent, layer, stage) as TaskGen;
    }
    const plugin: Plugin = { name: "faulty", tasks: { box: broken, text: weird } };
    const bp = blueprintOf([box("a", 0, 0), text("b", 0, 100, "hi")]);
    const h = harness(bp, { intro: false }, { plugins: [testPlugin, plugin] });
    const errors: string[] = [];
    h.engine.on("error", (e) => errors.push(e.error.message));
    void h.engine.play();
    h.until(() => h.engine.state === "finale", 10_000);
    expect(h.engine.state).toBe("finale");
    expect(h.stage.finished).toEqual(expect.arrayContaining(["a", "b"]));
    expect(errors).toEqual(['layer "a": boom', 'layer "b": task yielded an unsupported value of type string']);
  });

  it("drags each copy from the nearest finished copy, starting over from the master on replay", () => {
    const copies = [1, 2, 3, 4, 5].map((n) => box(`c${n}`, 20 + 130 * n, 20, 120, 60, { master: "m" }));
    const bp = blueprintOf([box("m", 20, 20, 120, 60), ...copies]);
    const h = harness(bp, { intro: false, agents: 1 }, { plugins: [builtinPlugin], estimate: choreoHelpers.estimate });
    // The duplicate choreography measures from the source it dragged the copy from.
    const sources = () => h.stage.overlays.filter((o) => o.kind === "measure").map((o) => (o.props.a as Rect).x);
    void h.engine.play();
    h.until(() => h.engine.state === "finale");
    expect(sources()).toEqual([20, 150, 280, 410, 540]);
    h.engine.replay();
    h.until(() => h.engine.state === "finale");
    expect(sources()).toEqual([20, 150, 280, 410, 540, 20, 150, 280, 410, 540]);
  });

  it("ready() waits for the stage and for promises tasks wait on; eta() counts down", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    function* waits(agent: AgentApi, layer: Layer, stage: StageApi): TaskGen {
      yield gate;
      yield* testPlugin.tasks?.box?.(agent, layer, stage) as TaskGen;
    }
    const h = harness(
      blueprintOf([box("a", 0, 0), box("b", 300, 0)]),
      { intro: false },
      {
        plugins: [testPlugin, { name: "wait", tasks: { box: waits } }],
      },
    );
    const eta0 = h.engine.eta();
    expect(eta0).toBeGreaterThan(0);
    void h.engine.play();
    h.run(30);
    let ready = false;
    void h.engine.ready().then(() => {
      ready = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toBe(false);
    release();
    await h.engine.ready();
    expect(ready).toBe(true);
    h.run(30);
    expect(h.engine.eta()).toBeLessThan(eta0);
    h.until(() => h.engine.state === "finale");
    expect(h.engine.eta()).toBe(0);
  });

  it("finish() completes the rest quickly and goLive() hands back to the page", async () => {
    const page = blueprintOf(Array.from({ length: 40 }, (_, i) => box(`b${i}`, (i % 5) * 150, Math.floor(i / 5) * 90)));
    const h = harness(page, { intro: false });
    const seen = states(h);
    void h.engine.play();
    h.run(20);
    h.engine.finish();
    const ms = h.until(() => h.engine.state === "finale");
    expect(ms).toBeLessThan(1500);
    expect(h.engine.progress).toEqual({ built: 40, total: 40 });
    h.engine.goLive();
    h.run(60);
    await Promise.resolve();
    expect(h.stage.calls.goLive).toBe(1);
    expect(h.engine.soundLog.at(-1)?.name).toBe("sweep");
    expect(seen.at(-1)).toBe("live");
    h.engine.destroy();
    expect(h.engine.state).toBe("destroyed");
    expect(h.stage.calls.destroy).toBe(1);
    expect(h.sound.destroyed).toBe(true);
  });

  it("keeps player time equal to clock time over long ticks after goLive() (low-fps export tail)", () => {
    const h = harness(samplePage(), { intro: false });
    void h.engine.play();
    h.until(() => h.engine.state === "finale");
    h.engine.goLive();
    const t0 = h.engine.time;
    h.clock.advance(250);
    expect(h.engine.time - t0).toBeCloseTo(250, 6);
  });

  it("seek() fast-forwards the current run and replays only to go back or after finish()", () => {
    const page = blueprintOf(Array.from({ length: 40 }, (_, i) => box(`b${i}`, (i % 5) * 150, Math.floor(i / 5) * 90)));
    const h = harness(page, { intro: false });
    void h.engine.play();
    h.run(30);
    h.engine.pause();
    const built = h.engine.progress.built;
    const head = h.engine.soundLog.slice();
    h.engine.seek(2000);
    // Forward: no replay, the run's log continues and a paused player stays paused.
    expect(h.stage.calls.reset).toBe(0);
    expect(h.engine.soundLog.slice(0, head.length)).toEqual(head);
    expect(h.engine.progress.built).toBeGreaterThan(built);
    expect(h.engine.state).toBe("paused");
    expect(h.engine.time).toBeCloseTo(2000, 3);
    h.engine.seek(1000);
    expect(h.stage.calls.reset).toBe(1);
    expect(h.engine.time).toBeCloseTo(1000, 3);
    h.engine.resume();
    h.engine.finish();
    h.engine.seek(3000);
    expect(h.stage.calls.reset).toBe(2);
  });

  it("sizes the crew automatically and labels agents per mode", () => {
    expect(autoAgentCount(0, 390 * 844)).toBe(8);
    expect(autoAgentCount(260, 1280 * 800)).toBeGreaterThan(30);
    expect(autoAgentCount(100_000, 2560 * 1440)).toBe(64);
    const labels = (mode: EngineSettings["labels"]): string[] => {
      const h = harness(samplePage(), { labels: mode, intro: false, agents: 3 });
      const seen = new Set<string>();
      const render = h.stage.render.bind(h.stage);
      h.stage.render = (now, agents) => {
        for (const a of agents) seen.add(a.label);
        render(now, agents);
      };
      void h.engine.play();
      h.run(90);
      return [...seen].sort();
    };
    expect(labels("agents")).toEqual(["Agent 01", "Agent 02", "Agent 03"]);
    expect(labels("roles")).toEqual(expect.arrayContaining(["", "role.layout"]));
    expect(labels("none")).toEqual([""]);
    expect(labels(["Ann", "Bo"])).toEqual(["Ann", "Bo"]);
  });
});
