/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CustomLayer, StageApi } from "@swarmloom/core";
import { strToU8, zipSync } from "fflate";
import type { AnimationItem } from "lottie-web";
import { describe, expect, it } from "vitest";
import {
  animTargetOf,
  createLottiePlugin,
  type LottieErrorCode,
  type LottiePlayerData,
  PLAYER_TASK,
  parseLottie,
  sniffLottie,
  unpackDotLottie,
} from "../src/index";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/lottie");
const shuttleJson = readFileSync(join(EXAMPLES, "shuttle-loop.json"), "utf8");
const shuttleArchive = new Uint8Array(readFileSync(join(EXAMPLES, "shuttle-loop.lottie")));

type Json = Record<string, unknown>;

const keyed = (t0: number, t1: number) => ({
  a: 1,
  k: [
    { t: t0, s: [0, 0], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
    { t: t1, s: [10, 10] },
  ],
});

function shapeLayer(extra: Json = {}): Json {
  return { ty: 4, ind: 1, nm: "shape", ks: { p: keyed(0, 30) }, ip: 0, op: 60, st: 0, shapes: [], ...extra };
}

function lottie(extra: Json = {}): Json {
  return { v: "5.12.0", fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [shapeLayer()], ...extra };
}

function codeOf(fn: () => unknown): LottieErrorCode | "ok" {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: LottieErrorCode }).code ?? (String(error) as LottieErrorCode);
  }
}

describe("sniffLottie", () => {
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
  it.each([
    ["the example JSON", strToU8(shuttleJson), true],
    ["the example .lottie", shuttleArchive, true],
    ["JSON with a BOM and spaces", bytes(`\uFEFF \n${JSON.stringify(lottie())}`), true],
    ["JSON without a version", bytes(JSON.stringify(lottie({ v: undefined }))), false],
    ["other JSON", bytes('{"name":"pkg","version":"1.0.0","layers":[]}'), false],
    ["a ZIP without a manifest", zipSync({ "word/document.xml": strToU8("<w/>") }), false],
    ["three bytes", bytes("{ }"), false],
  ])("%s -> %s", (_label, head, expected) => {
    expect(sniffLottie(head)).toBe(expected);
  });
});

describe("parseLottie", () => {
  const cycle = {
    assets: [{ id: "a", layers: [{ ty: 0, refId: "a", ks: {}, ip: 0, op: 60 }] }],
    layers: [{ ty: 0, refId: "a", ks: {}, ip: 0, op: 60 }],
  };
  it.each<[string, string, LottieErrorCode | "ok", Parameters<typeof parseLottie>[1]?]>([
    ["a valid animation", JSON.stringify(lottie()), "ok"],
    ["broken JSON", "{", "invalid"],
    ["a JSON array", "[]", "invalid"],
    ["no version", JSON.stringify(lottie({ v: undefined })), "invalid"],
    ["frame rate 0", JSON.stringify(lottie({ fr: 0 })), "invalid"],
    ["out point before in point", JSON.stringify(lottie({ ip: 10, op: 10 })), "invalid"],
    ["zero width", JSON.stringify(lottie({ w: 0 })), "invalid"],
    ["no layers", JSON.stringify(lottie({ layers: undefined })), "invalid"],
    ["a layer without a type", JSON.stringify(lottie({ layers: [{ ks: {}, ip: 0, op: 60 }] })), "invalid"],
    ["a precomposition that contains itself", JSON.stringify(lottie(cycle)), "invalid"],
    ["an hour-long animation", JSON.stringify(lottie({ fr: 1, op: 3600 })), "too-large"],
    ["hostile nesting", `{"v":"5.0.0","x":${"[".repeat(300)}${"]".repeat(300)}}`, "too-large"],
    [
      "too many layers",
      JSON.stringify(lottie({ layers: [shapeLayer(), shapeLayer()] })),
      "too-large",
      { maxLottieLayers: 1 },
    ],
    [
      "motion from expressions only",
      JSON.stringify(lottie({ layers: [shapeLayer({ ks: { o: { a: 0, k: 100, x: "wiggle(2, 30)" } } })] })),
      "unsupported",
    ],
  ])("%s -> %s", (_label, text, expected, options) => {
    expect(codeOf(() => parseLottie(text, options))).toBe(expected);
  });

  it("strips expressions, remote assets, audio, web fonts and random text order, and says so", () => {
    const text = {
      ty: 5,
      ind: 2,
      ks: {},
      ip: 0,
      op: 60,
      t: { d: { k: [{ t: 0, s: { t: "Hi", f: "Web" } }] }, a: [{ s: { rn: 1 }, a: {} }] },
    };
    const parsed = parseLottie(
      JSON.stringify(
        lottie({
          assets: [{ id: "img", u: "https://cdn.example/", p: "a.png", w: 10, h: 10 }],
          fonts: {
            list: [{ fName: "Web", fFamily: "Web<script>", fPath: "https://fonts.example/web.css", origin: 1 }],
          },
          layers: [
            shapeLayer({ ks: { p: keyed(0, 30), o: { a: 0, k: 100, x: "time * 10" } } }),
            text,
            { ty: 2, refId: "img", ks: {}, ip: 0, op: 60 },
            { ty: 6, ip: 0, op: 60 },
          ],
        }),
      ),
    );
    expect(parsed.json).not.toMatch(/https:|<script>|"x":"time|"rn":1/);
    expect(parsed.stats).toMatchObject({ layers: 4, images: 1, texts: 1, expressions: 1 });
    expect(parsed.notes).toHaveLength(5);
    expect(parsed.info).toMatchObject({ fr: 30, frames: 60, duration: 2000 });
    expect(parsed.keyTimes).toEqual([0, 30]);
  });

  it("drops a font list that is not a real list (lottie-web would still load it by index)", () => {
    const web = { fName: "Evil", fFamily: "Evil", fOrigin: "g", fPath: "https://example.invalid/evil.css" };
    const parsed = parseLottie(JSON.stringify(lottie({ fonts: { list: { 0: web, length: 1 } } })));
    expect(JSON.parse(parsed.json).fonts).toEqual({ list: [] });
    expect(parsed.notes).toContain("A malformed font list was removed.");
  });
});

describe("unpackDotLottie", () => {
  it("reads the example archive and its manifest", async () => {
    const content = await unpackDotLottie(shuttleArchive);
    expect(content).toMatchObject({ id: "shuttle-loop", loop: true, speed: 1, animation: shuttleJson, notes: [] });
  });

  it.each([
    ["an entry that escapes its folder", { "manifest.json": strToU8("{}"), "../a/x.json": strToU8("{}") }, "archive"],
    ["a zip bomb", { "animations/a.json": new Uint8Array(4 * 1024 * 1024) }, "archive"],
    ["no animation", { "manifest.json": strToU8('{"animations":[]}') }, "archive"],
  ])("rejects %s", async (_label, files, code) => {
    await expect(unpackDotLottie(zipSync(files, { level: 9 }))).rejects.toMatchObject({ code });
  });
});

describe("lottie:player timing", () => {
  const FRAME_MS = 1000 / 30;

  function playerLayer(loop: boolean | number): CustomLayer {
    const data: LottiePlayerData = { json: shuttleJson, rest: 60, loop, speed: 1, background: "#FAFAFC" };
    return { id: "player", kind: "custom", task: PLAYER_TASK, box: { x: 0, y: 0, w: 480, h: 300 }, data };
  }

  /**
   * Plays the example from engine time 500 ms in steps of `250 / perQuarter` ms (a fake engine
   * clock) and returns the frame lottie-web was told to show after every quarter second.
   */
  async function quarters(perQuarter: number, count: number, loop: boolean | number): Promise<number[]> {
    const calls: [number, boolean | undefined][] = [];
    const item = {
      goToAndStop: (frame: number, isFrame?: boolean) => calls.push([frame, isFrame]),
      destroy: () => undefined,
    };
    const runtime = { loadAnimation: () => item as unknown as AnimationItem };
    const plugin = createLottiePlugin({ runtime: async () => runtime });
    const layer = playerLayer(loop);
    const host = plugin.renderers?.[PLAYER_TASK]?.mount(layer, document.createElement("div"), {} as StageApi);
    const target = animTargetOf(host as HTMLElement);
    if (!target) throw new Error("the player registered no animation target");
    await target.ready?.();
    plugin.setup?.({} as StageApi, document.createElement("div"));
    let now = 500;
    target.play(0);
    plugin.frame?.(now, 16);
    const shown: number[] = [];
    for (let q = 1; q <= count; q++) {
      for (let i = 0; i < perQuarter; i++) {
        now += 250 / perQuarter;
        plugin.frame?.(now, 250 / perQuarter);
      }
      await Promise.resolve();
      shown.push(calls.at(-1)?.[0] ?? -1);
    }
    expect(calls.every(([frame, isFrame]) => Number.isInteger(frame) && isFrame === true)).toBe(true);
    // The engine clock going back (replay, seek) returns the player to the woven pose.
    plugin.frame?.(now - 1000, 16);
    expect(target.time()).toBeNull();
    return shown;
  }

  it("shows the same frame for the same transport time at any step size, frame edges included", async () => {
    // 60 Hz, 24 Hz and 4 Hz steps; quarter q shows frame floor(q * 7.5) of the 120-frame loop.
    const expected = Array.from({ length: 20 }, (_, i) => Math.floor(((i + 1) * 250) / FRAME_MS + 1e-9) % 120);
    expect(expected[3]).toBe(30);
    expect(await quarters(15, 20, true)).toEqual(expected);
    expect(await quarters(6, 20, true)).toEqual(expected);
    expect(await quarters(1, 20, true)).toEqual(expected);
  });

  it("plays n times, then holds the last frame", async () => {
    const shown = await quarters(6, 40, 2);
    expect(shown[15]).toBe(0);
    expect(shown.slice(31)).toEqual(Array(9).fill(119));
  });
});
