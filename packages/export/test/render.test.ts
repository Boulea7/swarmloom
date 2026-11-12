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
    // start() waits once, then every engine tick: 120 a second, plus a short tick to each 40 ms frame
    // that ends between two ticks (4 in 5): 1 + 144 + 24.
    expect(player.readyCalls).toBe(169);

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
    // next engine tick (608.3 ms, player time 408.3).
    expect(states.slice(11, 13)).toEqual(["building", "finale"]);
    expect(player.soundLog.map((e) => Math.round(e.t))).toEqual([250, 400, 408, 408, 408]);
    // The key at 250 sounded before the hold; the later ones move 200 ms later, onto the frame that shows them.
    expect((await api.soundLog()).map((e) => Math.round(e.t))).toEqual([250, 600, 608, 608, 608]);
    await api.audioWav();
    expect(audio.mock.calls[0]?.[0].map((e) => Math.round(e.t))).toEqual([250, 600, 608, 608, 608]);

    api.dispose();
    const bad: [unknown, string][] = [
      [{ ...base, cues: [{ at: 10, action: "rewind" }] }, "action must be one of pause, resume, finish"],
      [{ ...base, cues: [{ at: -1, action: "pause" }] }, "at must be a number within 0..3600000"],
      [{ ...base, cues: "pause" }, "cues must be an array"],
      [{ ...base, cues: [{ at: 0, action: "speed" }] }, "cues[0].speed is required"],
      [{ ...base, cues: [{ at: 0, action: "speed", speed: 0 }] }, "speed must be a number within 0.05..16"],
      [{ ...base, cues: [{ at: 0, action: "pause", speed: 2 }] }, 'cues[0].speed is only for a "speed" cue'],
    ];
    for (const [options, message] of bad) await expect(api.init(options as RenderInit)).rejects.toThrow(message);
  });

  it("passes the opening and liveTop on, and logs each stretch of scrolling on video time", async () => {
    const { api, players } = setup();
    await api.init({ ...base, opening: 500, liveTop: true });
    const [player] = players as [ClockPlayer];
    expect(player.options).toMatchObject({ opening: 500, liveTop: true });
    // The view after each 40 ms step: still, down 100 px over two steps, still, up 40 px, still.
    for (const y of [0, 0, 40, 100, 100, 100, 60, 60]) {
      player.scrollY = y;
      await api.step(40);
    }
    expect(await api.scrollLog()).toEqual([
      { t: 80, end: 160, from: 0, to: 100 },
      { t: 240, end: 280, from: 100, to: 60 },
    ]);
  });

  it("passes the intro through to the player", async () => {
    const { api, players } = setup();
    await api.init({ ...base, intro: "outline" });
    expect(players[0]?.options.intro).toBe("outline");
    api.dispose();
    const short = { ...base, intro: "short" } as unknown as RenderInit;
    await expect(api.init(short)).rejects.toThrow('intro must be a boolean or "outline"');
  });

  it("renders the soundtrack with the beat sync asked for", async () => {
    const { api, audio } = setup();
    await api.init({ ...base, bpm: 124, beatSync: "all" });
    await api.step(40);
    await api.audioWav();
    expect(audio.mock.calls[0]?.[2]?.sound).toEqual({ enabled: true, pack: undefined, bpm: 124, beatSync: "all" });
    api.dispose();
    await expect(api.init({ ...base, beatSync: false } as unknown as RenderInit)).rejects.toThrow(
      'beatSync must be true or "all"',
    );
  });

  it("changes the build speed at speed cues, on the engine tick that reaches them", async () => {
    const { api, players } = setup();
    await api.init({
      ...base,
      cues: [
        { at: 0, action: "speed", speed: 0.6 },
        { at: 120, action: "speed", speed: 0.45 },
      ],
    });
    for (let i = 0; i < 4; i++) await api.step(50);
    // 120 ms falls between the 1/120 s ticks at 116.7 and 125 ms; the frame at 150 ms shows it.
    expect((players[0] as ClockPlayer).speeds).toEqual([
      [0, 0.6],
      [125, 0.45],
    ]);
    api.dispose();
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
    expect((await api.soundLog()).map((e) => [e.name, Math.round(e.t)])).toEqual([
      ["key", 250],
      ["fanout", 500],
      ["key", 508],
      ["key", 508],
      ["key", 508],
    ]);
    api.dispose();
  });

  it("hashes the same blueprint across takes served under different random URLs", async () => {
    // Adapters copy the input URL into the blueprint, resolve assets against it and mint object URLs;
    // snapshots resolve in-page anchors (Markdown footnotes) against the render page's URL.
    const box = { x: 0, y: 0, w: 1, h: 1 };
    const { api } = setup((input) => ({
      ...blueprint,
      source: { type: "svg", name: input.name, url: input.url },
      layers: [
        { id: "a", kind: "image", box, src: new URL("logo.png", String(input.url)).href },
        { id: "b", kind: "image", box, src: `blob:${location.origin}/${Math.random()}` },
        {
          id: "c",
          kind: "text",
          box,
          style: {},
          text: "1",
          html: `<a href="${new URL("#fn-1", document.baseURI)}">1</a>`,
        },
      ],
    }));
    // happy-dom's own API: moves the page to another URL.
    const setPageUrl = (url: string) =>
      (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
    const pageUrl = location.href;
    // The driver serves the page and the input from a server on a random port.
    const take = async (port: number | null, url?: string) => {
      if (port !== null) setPageUrl(`http://127.0.0.1:${port}/index.html`);
      try {
        const input = { name: "a.svg", url: url ?? `${location.origin}/input/token${port}/a.svg` };
        const { blueprintSha256 } = await api.init({ ...base, input });
        api.dispose();
        return blueprintSha256;
      } finally {
        setPageUrl(pageUrl);
      }
    };
    const first = await take(4100);
    expect(await take(41001)).toBe(first);
    // A remote input URL is part of what was played.
    expect(await take(null, "https://example.com/a.svg")).not.toBe(await take(null, "https://example.org/a.svg"));
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

  it("keeps the player's realtime sound off and renders the soundtrack from its log", async () => {
    const { api, players, audio } = setup();
    await api.init({ ...base, pack: "soft" });
    // An enabled player would play every note aloud in a page with user activation (Studio).
    expect(players[0]?.options.sound).toBe(false);
    await api.step(1000);
    await api.audioWav();
    expect(audio.mock.calls[0]?.[0]).toHaveLength(4);
    expect(audio.mock.calls[0]?.[2]?.sound).toMatchObject({ enabled: true, pack: "soft" });
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
      [{ ...base, terminalFont: "big" }, "terminalFont must be one of fit, fill"],
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
