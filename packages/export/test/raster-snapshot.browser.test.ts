import { afterEach, expect, it } from "vitest";
import { server } from "vitest/browser";
import { FrameRasterizer } from "../src/browser/raster/rasterize";

const SIZE = 100;
const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

/** Loads `html` into a same-origin frame and returns its window with a rasterizer reading it. */
async function frameOf(html: string): Promise<{ win: Window; rasterizer: FrameRasterizer }> {
  const frame = document.createElement("iframe");
  frame.style.cssText = `border:0;width:${SIZE}px;height:${SIZE}px`;
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.srcdoc = html;
  document.body.append(frame);
  frames.push(frame);
  await loaded;
  const win = frame.contentWindow as Window;
  const rasterizer = new FrameRasterizer({
    document: win.document,
    width: SIZE,
    height: SIZE,
    shadows: { roots: () => [], stop() {} },
    fonts: { faces: () => [], stop() {} },
  });
  return { win, rasterizer };
}

/** Draws the frame and returns the RGB of pixel (x, y). */
async function pixel(rasterizer: FrameRasterizer, x: number, y: number): Promise<number[]> {
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  await rasterizer.draw(ctx);
  return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

it("draws a scrolled document at its scroll offset once, fixed boxes in view", async () => {
  const bands = Array.from({ length: 8 }, (_, i) => `<div style="height:100px;background:rgb(${i * 30},0,0)"></div>`);
  const { win, rasterizer } = await frameOf(
    `<!doctype html><body style="margin:0">${bands.join("")}` +
      '<i style="position:fixed;top:0;right:0;width:20px;height:20px;background:rgb(0,255,0)"></i>' +
      '<i style="position:absolute;top:350px;right:0;width:20px;height:20px;background:rgb(0,0,255)"></i></body>',
  );
  win.scrollTo(0, 300);
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  await rasterizer.draw(ctx);
  const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
  expect([at(5, 5), at(90, 5), at(90, 55)]).toEqual([
    [90, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ]);
});

it.each([
  ["a zero border width with a style", '<div style="border:0 solid rgb(255,0,0);width:60px;height:60px">', [0, 0, 255]],
  [
    "a border colour equal to the default text colour",
    '<div style="color:rgb(255,0,0);border:10px solid rgb(0,0,0);width:40px;height:40px">',
    [0, 0, 0],
  ],
  [
    "inherited values set on the root",
    '<html style="color:rgb(0,128,0)"><div style="border:10px solid;width:40px;height:40px">',
    [0, 128, 0],
  ],
])("draws %s", async (_name, html, expected) => {
  const { rasterizer } = await frameOf(`<style>body{margin:0}div{background:rgb(0,0,255)}</style>${html}`);
  expect(await pixel(rasterizer, 2, 2)).toEqual(expected);
});

it("writes one href for an SVG element that has both href and xlink:href", async () => {
  const { rasterizer } = await frameOf(
    '<body style="margin:0"><svg width=50 height=50 style="display:block">' +
      '<defs><rect id=r width=50 height=50 fill="rgb(255,0,0)"/></defs><use href="#r" xlink:href="#r"/></svg></body>',
  );
  // A duplicate attribute makes the SVG ill-formed, so it would not decode.
  expect(await pixel(rasterizer, 5, 5)).toEqual([255, 0, 0]);
});

it("keeps the counter steps of off-screen content", async () => {
  const sections = Array.from({ length: 8 }, (_, i) => `<section><h2>S${i + 1}</h2></section>`).join("");
  const { win, rasterizer } = await frameOf(
    "<style>body{margin:0;counter-reset:s}section{display:flow-root;height:200px}" +
      `h2{counter-increment:s}h2::before{content:counter(s)}</style>${sections}`,
  );
  win.scrollTo(0, 1200);
  const { svg } = await rasterizer.snapshot();
  // The snapshot counts again: a heading left out would lower every number after it.
  expect(svg.match(/<h2/g)).toHaveLength(8);
});

it("writes live form state without duplicating authored attributes", async () => {
  const { win, rasterizer } = await frameOf(
    "<input value=Go><input type=checkbox checked id=c><select><option>A<option selected>B</select>",
  );
  (win.document.getElementById("c") as HTMLInputElement).checked = false;
  const { svg } = await rasterizer.snapshot();
  expect(svg).not.toContain("checked");
  // A duplicate attribute makes the SVG ill-formed, so it would not decode.
  await expect(pixel(rasterizer, 0, 0)).resolves.toHaveLength(3);
});

it("flattens open shadow roots the watch never saw", async () => {
  const { rasterizer } = await frameOf(
    '<body style="margin:0"><div><template shadowrootmode=open>' +
      '<div style="width:50px;height:50px;background:rgb(255,0,0)"></div></template>' +
      '<div style="width:50px;height:50px;background:rgb(0,0,255)"></div></div></body>',
  );
  expect(await pixel(rasterizer, 10, 10)).toEqual([255, 0, 0]);
});

it("keeps the page's SVG style rules out of the snapshot", async () => {
  const { rasterizer } = await frameOf(
    '<body style="margin:0"><svg width=50 height=50 style="display:block"><style>rect{fill:rgb(255,0,0)}</style>' +
      '<rect width=50 height=50 style="fill:rgb(0,0,0)"/></svg></body>',
  );
  expect(await pixel(rasterizer, 5, 5)).toEqual([0, 0, 0]);
});

it("paints the root's or body's background images over the whole canvas, placed against the root", async () => {
  const { rasterizer } = await frameOf(
    '<html style="height:40px"><body style="margin:0;background:linear-gradient(rgb(255,0,0) 50%,rgb(0,0,255) 50%)">',
  );
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  await rasterizer.draw(ctx);
  const at = (y: number) => Array.from(ctx.getImageData(50, y, 1, 1).data.slice(0, 3));
  // The gradient repeats every 40 px (the root's height), below the root's box too.
  expect([at(10), at(30), at(90)]).toEqual([
    [255, 0, 0],
    [0, 0, 255],
    [255, 0, 0],
  ]);
});

it("keeps the native look of form controls and the UA's placeholder colour", async () => {
  const { rasterizer } = await frameOf(
    '<body style="margin:0"><progress value=1 style="display:block;width:100px"></progress>' +
      '<input placeholder=MMMM style="display:block;border:0;padding:0;width:100px;font:bold 30px sans-serif">',
  );
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  await rasterizer.draw(ctx);
  const [red = 0, green = 0, blue = 0] = ctx.getImageData(50, 8, 1, 1).data;
  const text = ctx.getImageData(0, 16, SIZE, 34).data.filter((_, i) => i % 4 === 0);
  // A clone given the UA's border or background as author styles draws a green fallback bar.
  // Firefox's native bar is a darker blue than Chromium's; both stay blue.
  expect(blue > 150 && green < 180 && red < 50).toBe(true);
  // Chromium's root clone used to pin the placeholder to the root's resolved text fill colour.
  // Firefox does not apply author ::placeholder rules inside an SVG image (a documented
  // pseudo-element limit), so the grey-placeholder assertion is Chromium-specific.
  if (server.browser !== "firefox") expect(Math.min(...text)).toBeGreaterThan(80);
});

it("draws a video's poster, and its controls over a dark backdrop when it has no picture", async () => {
  const red = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2" fill="red"/></svg>',
  );
  const { rasterizer } = await frameOf(
    `<body style="margin:0"><video width=100 height=50 style="display:block" poster="data:image/svg+xml,${red}"></video>` +
      '<video controls width=100 height=50 style="display:block"></video>',
  );
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  await rasterizer.draw(ctx);
  const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
  expect(at(50, 25)).toEqual([255, 0, 0]);
  expect(at(5, 55).every((c) => c < 64)).toBe(true);
});
