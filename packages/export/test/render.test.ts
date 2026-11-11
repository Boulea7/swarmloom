import type {
  Blueprint,
  LoadedSource,
  PlayerOptions,
  RenderOfflineOptions,
  SoundEvent,
  SourceInput,
} from "@swarmloom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { base64ToBytes, bytesToBase64, createRenderApi, type RenderDeps, type RenderInit } from "../src/index";
import { ClockPlayer } from "./fake-player";

const blueprint = {
  version: 1 as const,
  source: { type: "fake" },
  size: { w: 10, h: 10 },
  background: "#fff",
  layers: [],
};
const base: RenderInit = { input: { name: "a.md", text: "# Hi" }, width: 320, height: 200, fps: 25, tail: 200 };

function setup(make: (input: SourceInput) => Blueprint = () => blueprint, deps: Pick<RenderDeps, "awaitPaint"> = {}) {
  const players: ClockPlayer[] = [];
  const loads: { input: SourceInput; format?: string; width: number }[] = [];
  const dispose = vi.fn();
  const audio = vi.fn(async (events: readonly SoundEvent[], durationMs: number, _opts?: RenderOfflineOptions) =>
    Uint8Array.from([events.length, Math.round(durationMs / 10)]),
  );
  const api = createRenderApi({
    async load(input, ctx, { format }): Promise<LoadedSource> {
      loads.push({ input, format, width: ctx.width });
      return { blueprint: make(input), dispose };
    },
    createPlayer(options: PlayerOptions) {
      const player = new ClockPlayer(options);
      players.push(player);
      return player;
    },
    renderAudioWav: audio,
    ...deps,
  });
  return { api, players, loads, dispose, audio };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("render page protocol", () => {
  it("steps a virtual clock to done, then renders the soundtrack and cleans up", async () => {
    const { api, players, loads, dispose, audio } = setup();
    await expect(api.step(40)).rejects.toThrow("Call init() first");

    const { estimatedMs } = await api.init({
      ...base,
      input: { name: "x.bin", type: "md", base64: bytesToBase64(Uint8Array.from([35, 32, 72])) },
    });
    expect(estimatedMs).toBe(1200);
    expect(loads[0]).toMatchObject({
      format: "md",
      width: 320,
      input: { name: "x.bin", bytes: Uint8Array.from([35, 32, 72]) },
    });
    const [player] = players as [ClockPlayer];
    expect(player.options).toMatchObject({
      mode: "inline",
      controls: false,
      seed: 1,
      follow: "tour",
      reducedMotion: false,
    });
    expect(document.getElementById("swarmloom-render")?.style.width).toBe("320px");

    const steps = [];
    for (let i = 0; i < 40; i++) {
      const step = await api.step(40);
      steps.push(step);
      if (step.done) break;
    }
    // Built at 1000 ms (frame 25), done after the 200 ms tail (frame 30).
    expect(steps.findIndex((s) => s.state === "finale")).toBe(24);
    expect(steps).toHaveLength(30);
    expect(steps.at(-1)).toEqual({ state: "finale", built: 4, total: 4, done: true });
    expect(player.readyCalls).toBe(31);

    expect(base64ToBytes(await api.audioWav())).toEqual(Uint8Array.from([4, 120]));
    expect(audio.mock.calls[0]?.[2]).toMatchObject({ sampleRate: 48000, channels: 2 });

    await expect(api.init(base)).rejects.toThrow("already active");
    api.dispose();
    expect(player.destroyed).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(document.getElementById("swarmloom-render")).toBeNull();
    await api.init(base);
    expect(players).toHaveLength(2);
  });

  it("applies cues on frame boundaries and keeps sound events on video time across a pause", async () => {
    const { api, players, audio } = setup();
    // 4 layers over 1000 ms of player time: one key event per 250 ms. Hold 300..500 ms, then finish at 600.
    const info = await api.init({
      ...base,
      cues: [
        { at: 600, action: "finish" },
        { at: 300, action: "pause" },
        { at: 500, action: "resume" },
      ],
    });
    expect(info).toMatchObject({ layers: 0, blueprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const [player] = players as [ClockPlayer];
    const states: string[] = [];
    for (let i = 0; i < 20; i++) states.push((await api.step(50)).state);
    // Step i reaches (i + 1) * 50 ms: paused from the step that reached 300 ms to the one that reached 500.
    expect(states.slice(4, 10)).toEqual(["building", "paused", "paused", "paused", "paused", "building"]);
    // finish() at 600 ms fans out at once (player time 400) and completes the remaining layers on the
    // next tick (650 ms, player time 450).
    expect(states.slice(11, 13)).toEqual(["building", "finale"]);
    expect(player.soundLog.map((e) => e.t)).toEqual([250, 400, 450, 450, 450]);
    // The key at 250 sounded before the hold; the later ones move 200 ms later, onto the frame that shows them.
    expect((await api.soundLog()).map((e) => e.t)).toEqual([250, 600, 650, 650, 650]);
    await api.audioWav();
    expect(audio.mock.calls[0]?.[0].map((e) => e.t)).toEqual([250, 600, 650, 650, 650]);

    api.dispose();
    const bad: [unknown, string][] = [
      [{ ...base, cues: [{ at: 10, action: "rewind" }] }, "action must be one of pause, resume, finish"],
      [{ ...base, cues: [{ at: -1, action: "pause" }] }, "at must be a number within 0..3600000"],
      [{ ...base, cues: "pause" }, "cues must be an array"],
    ];
    for (const [options, message] of bad) await expect(api.init(options as RenderInit)).rejects.toThrow(message);
  });

  it("shifts the sounds a cue logs itself when it ends a pause", async () => {
    const { api } = setup();
    // Hold 300..500 ms; finish() ends the hold and fans out at once, which the video shows at 500 ms.
    await api.init({
      ...base,
      cues: [
        { at: 300, action: "pause" },
        { at: 500, action: "finish" },
      ],
    });
    for (let i = 0; i < 12; i++) await api.step(50);
    expect((await api.soundLog()).map((e) => [e.name, e.t])).toEqual([
      ["key", 250],
      ["fanout", 500],
      ["key", 550],
      ["key", 550],
      ["key", 550],
    ]);
    api.dispose();
  });

  it("hashes the same blueprint across takes served under different random URLs", async () => {
    // Adapters copy the input URL into the blueprint, resolve assets against it and mint object URLs.
    const box = { x: 0, y: 0, w: 1, h: 1 };
    const { api } = setup((input) => ({
      ...blueprint,
      source: { type: "svg", name: input.name, url: input.url },
      layers: [
        { id: "a", kind: "image", box, src: new URL("logo.png", String(input.url)).href },
        { id: "b", kind: "image", box, src: `blob:${location.origin}/${Math.random()}` },
      ],
    }));
    const take = async (url: string) => {
      const { blueprintSha256 } = await api.init({ ...base, input: { name: "a.svg", url } });
      api.dispose();
      return blueprintSha256;
    };
    const first = await take(`${location.origin}/input/tokenA/a.svg`);
    expect(await take(`${location.origin}/input/tokenB/a.svg`)).toBe(first);
    // A remote input URL is part of what was played.
    expect(await take("https://example.com/a.svg")).not.toBe(await take("https://example.org/a.svg"));
  });

  it("plays a driver-supplied blueprint instead of loading the input", async () => {
    const { api, players, loads } = setup();
    const live = { ...blueprint, source: { type: "dom" }, layers: [{ id: "t1", kind: "text", text: "Hi" }] };
    const info = await api.init({ ...base, blueprint: live } as RenderInit);
    expect(loads).toHaveLength(0);
    expect(players[0]?.options.blueprint).toBe(live);
    expect(info.layers).toBe(1);
  });

  it.each([
    [{}, 1],
    [{ live: false }, 0],
    [{ reducedMotion: true }, 0],
  ])("goes live once the finale settles (%j: %i call)", async (options, calls) => {
    const { api, players } = setup();
    await api.init({ ...base, ...options, tail: 2000 });
    const [player] = players as [ClockPlayer];
    const goLive = vi.spyOn(player, "goLive");
    for (let i = 0; i < 30; i++) await api.step(40);
    expect(player.state).toBe("finale");
    expect(goLive).not.toHaveBeenCalled();
    // The engine moves a settled finale to "done".
    player.state = "done";
    await api.step(40);
    await api.step(40);
    expect(goLive).toHaveBeenCalledTimes(calls);
  });

  it("goes live at a live cue instead of when the finale settles", async () => {
    const { api, players } = setup();
    await api.init({ ...base, tail: 2000, cues: [{ at: 1400, action: "live" }] });
    const [player] = players as [ClockPlayer];
    const goLive = vi.spyOn(player, "goLive");
    for (let i = 0; i < 30; i++) await api.step(40);
    player.state = "done";
    await api.step(40);
    await api.step(40);
    expect(goLive).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) await api.step(40);
    expect(goLive).toHaveBeenCalledOnce();
  });

  it("resolves init and each step only after three animation frames when it awaits paint", async () => {
    const { api } = setup(undefined, { awaitPaint: true });
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
    const runFrames = async (from: number, to: number) => {
      for (let i = from; i < to; i++) {
        await vi.waitFor(() => expect(frames).toHaveLength(i + 1));
        frames[i]?.(i * 16);
      }
    };
    const init = api.init(base);
    await runFrames(0, 3);
    await init;
    let stepped = false;
    const step = api.step(40).then(() => {
      stepped = true;
    });
    await runFrames(3, 5);
    await Promise.resolve();
    expect(stepped).toBe(false);
    await runFrames(5, 6);
    await step;
    expect(stepped).toBe(true);
    raf.mockRestore();
  });

  it("renders silence when sound is off", async () => {
    const { api, audio } = setup();
    await api.init({ ...base, sound: false });
    await api.step(1000);
    await api.audioWav();
    expect(audio).toHaveBeenCalledWith([], 1000, expect.anything());
  });

  it("renders the soundtrack for the length the driver asks for (the video is one frame longer)", async () => {
    const { api, audio } = setup();
    await api.init(base);
    await api.step(1000);
    await api.audioWav(1040);
    expect(audio).toHaveBeenLastCalledWith(expect.anything(), 1040, expect.anything());
  });

  it("rejects invalid init options and steps with a field name", async () => {
    const { api, players } = setup();
    const bad: [unknown, string][] = [
      [null, "options must be an object"],
      [{ ...base, input: { name: "a.md" } }, "input needs base64, text or url"],
      [{ ...base, width: 0 }, "width must be a number within 16..8192"],
      [{ ...base, fps: Number.NaN }, "fps must be a number"],
      [{ ...base, theme: "neon" }, "theme must be one of auto, light, dark"],
      [{ ...base, overlays: "some" }, "overlays must be one of full, minimal, none"],
      [{ ...base, live: "yes" }, "live must be a boolean"],
      [{ ...base, input: { name: "a", base64: "%%%" } }, "not valid base64"],
      [{ ...base, blueprint: { version: 2, size: { w: 1, h: 1 }, layers: [] } }, "blueprint must be a version 1"],
    ];
    for (const [options, message] of bad) await expect(api.init(options as RenderInit)).rejects.toThrow(message);
    expect(players).toHaveLength(0);
    expect(document.getElementById("swarmloom-render")).toBeNull();

    await api.init(base);
    await expect(api.step(-1)).rejects.toThrow(RangeError);
    await expect(api.step(60_000)).rejects.toThrow("step() needs 0 <= ms <= 10000");
  });
});
