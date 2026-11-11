import {
  type Blueprint,
  type CustomLayer,
  createPlayer,
  type Layer,
  type Plugin,
  type StageApi,
  VirtualClock,
} from "@swarmloom/core";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import shuttleJson from "../../../examples/lottie/shuttle-loop.json?raw";
import shuttleUrl from "../../../examples/lottie/shuttle-loop.lottie?url";
import {
  type AnimTimelineData,
  animTargetOf,
  collectKeyframes,
  type LottieLoadedSource,
  type LottiePlayerData,
  lottieAdapter,
  PLAYER_TASK,
  TIMELINE_TASK,
} from "../src/index";

const ctx = { document, width: 640, theme: "light" as const };
const PLAYER_ID = "lottie-player";

function byKind<K extends Layer["kind"]>(layers: readonly Layer[], kind: K): Extract<Layer, { kind: K }>[] {
  return layers.filter((l): l is Extract<Layer, { kind: K }> => l.kind === kind);
}

function custom(blueprint: Blueprint, task: string): CustomLayer {
  const layer = byKind(blueprint.layers, "custom").find((l) => l.task === task);
  if (!layer) throw new Error(`no ${task} layer`);
  return layer;
}

async function loadExample(): Promise<LottieLoadedSource> {
  return (await lottieAdapter.load({ text: shuttleJson, name: "shuttle-loop.json" }, ctx)) as LottieLoadedSource;
}

/**
 * Plays a loaded source to "done" with the real player on a virtual clock; returns its stage.
 * `finishEarly` presses "finish now" as soon as the build starts, before the timeline task runs.
 */
async function playToDone(loaded: LottieLoadedSource, { reducedMotion = false, finishEarly = false } = {}) {
  let stage: StageApi | null = null;
  const probe: Plugin = {
    name: "probe",
    setup(s) {
      stage = s;
    },
  };
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = "position:relative;width:640px;height:520px";
  const clock = new VirtualClock();
  const player = createPlayer({
    blueprint: loaded.blueprint,
    plugins: [...(loaded.plugins ?? []), probe],
    host,
    clock,
    seed: 3,
    sound: false,
    controls: false,
    reducedMotion,
  });
  const errors: string[] = [];
  player.on("error", (e) => errors.push(e.error.message));
  void player.play();
  for (let i = 0; i < 60 * 90 && player.state !== "done"; i++) {
    if (finishEarly && player.state === "building") {
      player.finish?.();
      finishEarly = false;
    }
    clock.advance(1000 / 60);
    // Tasks may wait for lottie-web to load: let promises settle as an exporter does.
    if (i % 20 === 0) await player.ready();
  }
  expect(player.state).toBe("done");
  expect(errors).toEqual([]);
  if (!stage) throw new Error("plugin setup was not called");
  const advance = async (ms: number): Promise<void> => {
    for (let i = Math.round((ms * 60) / 1000); i > 0; i--) clock.advance(1000 / 60);
    await player.ready();
  };
  const close = (): void => {
    player.destroy();
    host.remove();
  };
  return { stage: stage as StageApi, advance, close };
}

afterEach(() => {
  // The adapter must not leave its sandbox behind.
  expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
});

describe("lottieAdapter on the example", () => {
  it("weaves the fullest frame as vector layers, then adds the player and the timeline", async () => {
    const loaded = await loadExample();
    const { blueprint } = loaded;
    expect(blueprint.source).toMatchObject({ type: "lottie", title: "SwarmLoom shuttle loop" });
    // 480 x 300 scaled to 640 px wide, plus the timeline strip; the paper solid became the background.
    expect(blueprint.size).toEqual({ w: 640, h: 456 });
    expect(blueprint.background).toBe("rgb(250, 250, 252)");
    expect(blueprint.plugins).toEqual(["lottie", "anim:timeline"]);
    expect(loaded.notes).toEqual([]);

    // Loom frame, five warp threads, the weft, the shuttle hull and bobbin; the caption as one line.
    const paths = byKind(blueprint.layers, "path");
    expect(paths).toHaveLength(9);
    expect(byKind(blueprint.layers, "text").map((t) => t.text)).toEqual(["woven by many hands"]);
    expect(paths.filter((p) => p.stroke === "rgb(19, 184, 166)")).toHaveLength(5);
    // Frame 60: the trim path has drawn the whole weft.
    expect(paths.find((p) => p.stroke === "rgb(255, 107, 91)")?.box.w).toBeGreaterThan(400);
    expect(blueprint.layers).toHaveLength(12);

    const player = custom(blueprint, PLAYER_TASK);
    expect(player.data as LottiePlayerData).toMatchObject({ rest: 60, loop: true, speed: 1 });
    expect(player.box).toEqual({ x: 0, y: 0, w: 640, h: 400 });
    const timeline = custom(blueprint, TIMELINE_TASK);
    expect(timeline.data as AnimTimelineData).toMatchObject({
      target: PLAYER_ID,
      duration: 4000,
      keyframes: [0, 800, 2000, 2800, 3200, 3733.333, 4000],
      rest: 2000,
    });
    // The player is built first, the timeline after the woven layers.
    const priorities = blueprint.layers.map((l) => l.priority ?? 0);
    expect(player.priority).toBe(Math.min(...priorities));
    expect(timeline.priority).toBe(Math.max(...priorities));
    expect(timeline.parent).toBeDefined();
    loaded.dispose?.();
  });

  it("reads the same animation from the .lottie archive", async () => {
    const bytes = new Uint8Array(await (await fetch(shuttleUrl)).arrayBuffer());
    const fromArchive = await lottieAdapter.load({ bytes, name: "shuttle-loop.lottie" }, ctx);
    const fromJson = await loadExample();
    const shapes = (b: Blueprint) => byKind(b.layers, "path").map((p) => p.d);
    expect(shapes(fromArchive.blueprint)).toEqual(shapes(fromJson.blueprint));
    expect(fromArchive.blueprint.layers).toHaveLength(12);
  });

  it.each([
    ["#000000", "rgb(0, 0, 0)", "dark"],
    ["#00000080", "rgb(125, 125, 126)", "dark"],
    ["#0000", "#FAFAFC", "light"],
  ])("uses the .lottie manifest background %s when no solid fills the canvas", async (color, background, scheme) => {
    // A white stroked square and no canvas solid: the manifest is the only source of the background.
    const square = {
      ty: "gr",
      it: [
        { ty: "rc", p: { a: 0, k: [50, 50] }, s: { a: 0, k: [40, 40] }, r: { a: 0, k: 0 } },
        { ty: "st", c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 4 } },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } },
      ],
    };
    const json = {
      v: "5.12.0",
      fr: 30,
      ip: 0,
      op: 30,
      w: 100,
      h: 100,
      layers: [{ ty: 4, ind: 1, ks: {}, ip: 0, op: 30, st: 0, shapes: [square] }],
    };
    const bytes = zipSync({
      "manifest.json": strToU8(JSON.stringify({ animations: [{ id: "a", background: color }] })),
      "animations/a.json": strToU8(JSON.stringify(json)),
    });
    const { blueprint } = await lottieAdapter.load({ bytes, name: "a.lottie" }, ctx);
    expect(blueprint).toMatchObject({ background, scheme });
    expect((custom(blueprint, PLAYER_TASK).data as LottiePlayerData).background).toBe(background);
  });

  it("gives the host turns while it picks the pose, and stops there when aborted", async () => {
    // A host task pings until it finds the off-screen render up, then aborts the load.
    const controller = new AbortController();
    const ping = new MessageChannel();
    let sawRender = false;
    ping.port1.onmessage = () => {
      if (document.querySelector("[data-swarmloom-sandbox]")) {
        sawRender = true;
        controller.abort();
      } else if (!controller.signal.aborted) ping.port2.postMessage(null);
    };
    ping.port2.postMessage(null);
    const load = lottieAdapter.load({ text: shuttleJson, name: "x.json" }, { ...ctx, signal: controller.signal });
    try {
      await expect(load).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      controller.abort();
      ping.port1.close();
    }
    expect(sawRender).toBe(true);
  });
});

describe("lottie playback with the real player", () => {
  it("plays to done, then the animation follows the engine clock only", async () => {
    const loaded = await loadExample();
    const { stage, advance, close } = await playToDone(loaded);
    const el = stage.el(PLAYER_ID);
    const target = animTargetOf(el);
    expect(el?.querySelector("svg")).not.toBeNull();
    expect((el as HTMLElement).style.visibility).toBe("");
    const t0 = target?.time() ?? Number.NaN;
    expect(Number.isFinite(t0)).toBe(true);

    // One second of engine time is 30 frames later in the 4 s loop.
    await advance(1000);
    const t1 = target?.time() ?? Number.NaN;
    expect((t1 - t0 + 4000) % 4000).toBeCloseTo(1000, 6);
    // Real time without engine time moves nothing: lottie-web runs no clock of its own.
    await new Promise((r) => setTimeout(r, 120));
    expect(target?.time()).toBe(t1);
    close();
    loaded.dispose?.();
  });

  it("keeps the woven pose with reduced motion", async () => {
    const loaded = await loadExample();
    const { stage, advance, close } = await playToDone(loaded, { reducedMotion: true });
    const el = stage.el(PLAYER_ID) as HTMLElement;
    await advance(500);
    expect(animTargetOf(el)?.time()).toBeNull();
    expect(el.style.visibility).toBe("hidden");
    close();
    loaded.dispose?.();
  });

  it("still plays when the build is finished before the timeline ran", async () => {
    const loaded = await loadExample();
    const { stage, advance, close } = await playToDone(loaded, { finishEarly: true });
    const el = stage.el(PLAYER_ID) as HTMLElement;
    const target = animTargetOf(el);
    await target?.ready?.();
    // Before the fix the woven pose stayed and time() was null for good.
    const t0 = target?.time() ?? Number.NaN;
    expect(Number.isFinite(t0)).toBe(true);
    await advance(500);
    expect(((target?.time() ?? Number.NaN) - t0 + 4000) % 4000).toBeCloseTo(500, 6);
    expect(el.style.visibility).toBe("");
    close();
    loaded.dispose?.();
  });

  it("plays two players of one loaded source without resetting each other", async () => {
    const loaded = await loadExample();
    const first = await playToDone(loaded);
    const second = await playToDone(loaded);
    const one = animTargetOf(first.stage.el(PLAYER_ID));
    const two = animTargetOf(second.stage.el(PLAYER_ID));
    const t1 = one?.time() ?? Number.NaN;
    const t2 = two?.time() ?? Number.NaN;
    expect(Number.isFinite(t1) && Number.isFinite(t2)).toBe(true);
    // Each player moves only with its own clock.
    await first.advance(500);
    await second.advance(1000);
    expect(((one?.time() ?? Number.NaN) - t1 + 4000) % 4000).toBeCloseTo(500, 6);
    expect(((two?.time() ?? Number.NaN) - t2 + 4000) % 4000).toBeCloseTo(1000, 6);
    expect((first.stage.el(PLAYER_ID) as HTMLElement).querySelector("svg")).not.toBeNull();
    first.close();
    second.close();
    loaded.dispose?.();
  });
});

describe("collectKeyframes", () => {
  it("reads Web Animations and SMIL timing, skipping event-based begins", () => {
    const box = document.body.appendChild(document.createElement("div"));
    const anim = box.animate([{ opacity: 0 }, { opacity: 0.5, offset: 0.25 }, { opacity: 1 }], {
      duration: 2000,
      delay: 500,
    });
    anim.pause();
    expect(collectKeyframes(box)).toEqual({ duration: 2500, keyframes: [500, 1000, 2500] });
    anim.cancel();

    const holder = document.body.appendChild(document.createElement("div"));
    holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5">
      <animate attributeName="x" begin="1s" dur="3s" keyTimes="0;0.5;1" values="0;5;0"/>
      <animate attributeName="y" begin="click" dur="9s" values="0;5"/></rect></svg>`;
    const svg = holder.querySelector("svg") as SVGSVGElement;
    expect(collectKeyframes(svg)).toEqual({ duration: 4000, keyframes: [1000, 2500, 4000] });
    expect(collectKeyframes(svg, { subtree: false })).toBeNull();
    box.remove();
    holder.remove();
  });
});
