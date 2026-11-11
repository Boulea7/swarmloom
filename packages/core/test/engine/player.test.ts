import { describe, expect, it, vi } from "vitest";
import { VirtualClock } from "../../src/clock";
import { assemblePlayer, type PlayerZones } from "../../src/engine/assemble";
import type { Controls, ControlsOptions, I18n, StageOptions } from "../../src/internal";
import type { AgentApi, Layer, Plugin, SoundOptions, StageApi, TaskGen } from "../../src/types";
import { FakeSound, FakeStage, samplePage, theme } from "./fakes";

// The theme, stage, sound, toolbar, i18n and choreography zones are fakes: this file checks
// only how the player is assembled from them.

function tagged(tag: string, ran: string[]): Plugin["tasks"] {
  return {
    *box(agent: AgentApi, layer: Layer, stage: StageApi): TaskGen {
      ran.push(`${tag}:${layer.id}`);
      yield* agent.moveTo(layer.box.x, layer.box.y);
      stage.finish(layer.id);
    },
  };
}

function fakeZones() {
  const ran: string[] = [];
  const stages: FakeStage[] = [];
  const sounds: FakeSound[] = [];
  const controls: { host: HTMLElement; player: unknown; destroyed: boolean; timeline: ControlsOptions["timeline"] }[] =
    [];
  const i18n: I18n = { locale: "en", t: (key) => key };
  const zones = {
    resolveTheme: vi.fn(() => theme),
    createStage: vi.fn((opts: StageOptions) => {
      const stage = new FakeStage(opts.blueprint);
      stages.push(stage);
      return stage;
    }),
    createSound: vi.fn((_opts: SoundOptions) => {
      const sound = new FakeSound();
      sounds.push(sound);
      return sound;
    }),
    createControls: vi.fn((opts: ControlsOptions): Controls => {
      const entry = { host: opts.host, player: opts.player, destroyed: false, timeline: opts.timeline };
      controls.push(entry);
      return {
        setVisible() {},
        destroy() {
          entry.destroyed = true;
        },
      };
    }),
    createI18n: vi.fn(() => i18n),
    builtinPlugin: { name: "builtin", tasks: tagged("builtin", ran) },
    choreo: { estimate: () => 400 },
  } satisfies PlayerZones;
  return { zones, ran, stages, sounds, controls };
}

describe("assemblePlayer", () => {
  it("wires theme, stage, sound and controls, and later plugins override task keys", () => {
    const { zones, ran, stages, sounds, controls } = fakeZones();
    const host = document.createElement("div");
    const clock = new VirtualClock();
    const player = assemblePlayer(
      {
        blueprint: samplePage(),
        host,
        clock,
        seed: 5,
        intro: false,
        plugins: [
          { name: "a", tasks: tagged("a", ran) },
          { name: "b", tasks: tagged("b", ran) },
        ],
      },
      zones,
    );
    const stage = stages[0] as FakeStage;
    const args = zones.createStage.mock.calls[0]?.[0];
    expect(args?.mode).toBe("inline");
    expect(args?.host).toBe(host);
    expect(args?.theme).toBe(theme);
    expect(args?.plugins.map((p) => p.name)).toEqual(["builtin", "a", "b"]);
    expect(zones.createSound.mock.calls.at(-1)?.[0]).toMatchObject({ seed: 5 });
    expect(controls[0]?.host).toBe(stage.uiLayer);
    expect(controls[0]?.player).toBe(player);
    // Toolbar and stage follow the same resolved reduced-motion setting.
    expect(zones.createControls.mock.calls[0]?.[0].reducedMotion).toBe(args?.reducedMotion);
    expect(typeof player.finish).toBe("function");
    // The seek bar is opt-in: without `scrubber` the toolbar gets no timeline.
    expect(controls[0]?.timeline).toBeUndefined();

    void player.play();
    for (let i = 0; i < 400 && player.state !== "finale"; i++) clock.advance(1000 / 60);
    expect(player.state).toBe("finale");
    expect(ran.length).toBeGreaterThan(0);
    expect(ran.every((r) => r.startsWith("b:"))).toBe(true);

    player.destroy();
    expect(controls[0]?.destroyed).toBe(true);
    expect(stage.calls.destroy).toBe(1);
    expect(sounds[0]?.destroyed).toBe(true);
  });

  it("gives every player its own instance of a plugin with perPlayer()", () => {
    const { zones } = fakeZones();
    const made: Plugin[] = [];
    const shared: Plugin = {
      name: "anim",
      perPlayer: () => {
        const own: Plugin = { name: "anim" };
        made.push(own);
        return own;
      },
    };
    const players = [1, 2].map(() =>
      assemblePlayer({ blueprint: samplePage(), host: document.createElement("div"), plugins: [shared] }, zones),
    );
    const used = zones.createStage.mock.calls.map((call) => call[0].plugins[1]);
    expect(made).toHaveLength(2);
    expect(used[0]).toBe(made[0]);
    expect(used[1]).toBe(made[1]);
    for (const player of players) player.destroy();
    const renamed: Plugin = { name: "anim", perPlayer: () => ({ name: "other" }) };
    const options = { blueprint: samplePage(), host: document.createElement("div"), plugins: [renamed] };
    expect(() => assemblePlayer(options, zones)).toThrow('perPlayer() must return a plugin named "anim"');
  });

  it("gives the toolbar a timeline when the shell asks for a scrubber, and seeking follows it", () => {
    const { zones, controls } = fakeZones();
    const clock = new VirtualClock();
    const player = assemblePlayer(
      { blueprint: samplePage(), host: document.createElement("div"), clock, intro: false, scrubber: true },
      zones,
    );
    const timeline = controls[0]?.timeline;
    if (!timeline) throw new Error("no timeline seam");
    expect(timeline()).toEqual({ elapsed: 0, duration: 0 });
    void player.play();
    for (let i = 0; i < 30; i++) clock.advance(1000 / 60);
    const mid = timeline();
    expect(mid.elapsed).toBeCloseTo(500, 0);
    expect(mid.duration).toBeGreaterThan(mid.elapsed);
    for (let i = 0; i < 400 && player.state !== "finale"; i++) clock.advance(1000 / 60);
    const end = timeline();
    expect(end.elapsed).toBe(end.duration);
    player.seek?.(end.duration / 2);
    expect(player.state).toBe("building");
    expect(timeline().elapsed).toBeCloseTo(end.duration / 2, 0);
    expect(player.progress.built).toBeLessThan(player.progress.total);
    player.destroy();
  });

  it("rejects bad options before mounting anything and releases the stage on later failures", () => {
    const { zones, stages, controls } = fakeZones();
    const blueprint = samplePage();
    const bad: unknown[] = [
      null,
      { blueprint: { version: 2 } },
      { blueprint, seed: Number.NaN },
      { blueprint, speed: 0 },
      { blueprint, follow: "sideways" },
      { blueprint, mode: "inline" },
      { blueprint, clock: {} },
      { blueprint, plugins: [{ tasks: {} }] },
      { blueprint, scrubber: "yes" },
    ];
    for (const options of bad) expect(() => assemblePlayer(options as never, zones)).toThrow();
    expect(zones.createStage).not.toHaveBeenCalled();

    zones.createSound.mockImplementationOnce(() => {
      throw new Error("no audio");
    });
    expect(() => assemblePlayer({ blueprint, controls: false }, zones)).toThrow("no audio");
    expect(stages[0]?.calls.destroy).toBe(1);
    expect(controls).toHaveLength(0);
  });
});
