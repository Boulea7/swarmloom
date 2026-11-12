import { afterEach, expect, it, vi } from "vitest";
import type { Stage } from "../../src/internal";
import { createRng } from "../../src/rng";
import { createStage } from "../../src/stage";
import { resolveTheme } from "../../src/theme";
import type { Blueprint, Layer } from "../../src/types";

// An export ticks the engine 120 times a second but captures only some of those frames: the stage
// skips the work nobody sees, and the frames it captures must not show the difference.

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
/** Caret blink half-period in the overlay painters, ms. */
const BLINK_MS = 530;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function mount(layers: Layer[]): Stage {
  const host = document.createElement("div");
  host.style.cssText = "width:800px;height:600px;position:relative";
  document.body.append(host);
  const bp: Blueprint = { version: 1, source: { type: "test" }, size: { w: 800, h: 600 }, background: "#fff", layers };
  const stage = createStage({
    blueprint: bp,
    mode: "inline",
    host,
    theme: resolveTheme("auto", bp, false),
    plugins: [],
    reducedMotion: false,
    rng: createRng(7),
  });
  cleanups.push(() => {
    stage.destroy();
    host.remove();
  });
  return stage;
}

it("leaves the canvas alone on a frame nobody sees; the next frame shows what painting each one would", async () => {
  const stage = mount([]);
  const canvas = stage.root.querySelector("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const dpr = canvas.width / Number.parseFloat(canvas.style.width);
  const pixel = (x: number, y: number): number[] => [
    ...ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data,
  ];
  // The world is scaled to the host's client width, so the 2 px caret is looked for along a row.
  const inked = (x: number, y: number, w: number): boolean =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.round(w * dpr), 1).data.some((v) => v > 0);
  const red = document.createElement("canvas");
  red.width = red.height = 4;
  const g = red.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#f00";
  g.fillRect(0, 0, 4, 4);
  stage.overlay("icon", { x: 200, y: 200, size: 48, src: red.toDataURL() });
  stage.overlay("caret", { x: 400, y: 100, h: 20 });

  stage.render(0, [], false);
  expect(pixel(200, 200)[3]).toBe(0);
  // The icon's image loads before any frame shows it, not on the first painted one.
  await stage.ready();
  // The caret blinks on the time it appeared, an unseen frame included: off 1.5 periods later, on at 2.5.
  stage.render(BLINK_MS * 1.5, []);
  expect(pixel(200, 200).slice(0, 3)).toEqual([255, 0, 0]);
  expect(inked(370, 110, 40)).toBe(false);
  stage.render(BLINK_MS * 2.5, []);
  expect(inked(370, 110, 40)).toBe(true);
});

it("decodes each image and media snapshot once, however often ready() asks", async () => {
  const decode = vi.spyOn(HTMLImageElement.prototype, "decode");
  cleanups.push(() => decode.mockRestore());
  const stage = mount([
    { id: "i", kind: "image", box: { x: 0, y: 0, w: 100, h: 100 }, src: PNG_1PX },
    { id: "m", kind: "media", box: { x: 0, y: 120, w: 100, h: 100 }, label: "clip", src: PNG_1PX },
  ]);
  for (let i = 0; i < 3; i++) await stage.ready();
  expect(decode).toHaveBeenCalledTimes(2);
});
