import { afterEach, expect, it, vi } from "vitest";
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

/** An ordered list whose first 30 items sit far above the view in a wrapper, between `open` and `close`. */
const list = (open = "", close = "") =>
  "<style>body{margin:0;font:10px/10px monospace}ol,ul{margin:0}div{padding:1px 0}</style>" +
  `<ol><div>${open}${"<li>i".repeat(30)}${close}</div><div style=height:400px></div><div><li>i<li>i</div></ol>`;

/** `box` far above the view, then a paragraph that shows the counter `name` in its scope. */
const numbered = (box: string, name: string) =>
  `<style>body{margin:0;font:10px/10px monospace}ol{margin:0}.far{position:absolute;top:-3000px}p::before{content:counter(${name})}</style>` +
  `${box}<div style=height:400px></div><p></p>`;

it.each([
  [
    "explicit counters",
    "<style>body{margin:0;counter-reset:s}section{display:flow-root;height:200px}" +
      "h2{counter-increment:s}h2::before{content:counter(s)}</style>" +
      Array.from({ length: 8 }, (_, i) => `<section><h2>S${i + 1}</h2></section>`).join(""),
    /<h2/g,
    8,
  ],
  ["list items of the outer list", list(), /<li/g, 32],
  // Items of a list of their own number nothing after it: their wrapper still goes empty.
  ["a list of its own", list("<ul>", "</ul>"), /<li/g, 2],
  // A box's own reset numbers the boxes after it, a list's items step its counter for them too.
  ["a reset out of flow", numbered('<div class=far style="counter-reset:n 4">i</div>', "n"), />i</g, 1],
  ["a list out of flow", numbered("<ol class=far start=4><li>i</ol>", "list-item"), /<li/g, 1],
  [
    "the items of a far list",
    numbered(`<ol style=display:flow-root>${"<li>i".repeat(30)}</ol>`, "list-item"),
    /<li/g,
    30,
  ],
])("keeps the counters of off-screen content: %s", async (_name, html, tag, count) => {
  const { win, rasterizer } = await frameOf(html);
  win.scrollTo(0, win.document.documentElement.scrollHeight);
  const { svg } = await rasterizer.snapshot();
  // The snapshot counts again: an item left out would lower every number after it.
  expect(svg.match(tag)).toHaveLength(count);
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

it("leaves page text that spells a resource token as it is", async () => {
  const forged = "\uE000i0\uE001";
  const { rasterizer } = await frameOf(
    `<style>p::after{content:"${forged}"}</style><body style="margin:0">` +
      `<p title="${forged}" style="margin:0;height:50px;color:rgb(255,0,0);background:rgb(255,0,0)">${forged}</p></body>`,
  );
  const { svg } = await rasterizer.snapshot();
  // In the page's style element and the ::after rule, the title and the text.
  expect(svg.split(forged)).toHaveLength(5);
  // Taken for a token, the title would get an unescaped src="..." and the SVG would not decode.
  expect(await pixel(rasterizer, 5, 5)).toEqual([255, 0, 0]);
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
  const { win, rasterizer } = await frameOf(
    '<body style="margin:0"><progress value=1 style="display:block;width:100px"></progress>' +
      '<input placeholder=MMMM style="display:block;border:0;padding:0;width:100px;font:bold 30px sans-serif">',
  );
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  await rasterizer.draw(ctx);
  // The bar's middle row: WebKit's native bar is 6px tall, Chromium's and Firefox's taller.
  const bar = (win.document.querySelector("progress") as HTMLElement).getBoundingClientRect();
  const [red = 0, green = 0, blue = 0] = ctx.getImageData(50, Math.floor(bar.top + bar.height / 2), 1, 1).data;
  const text = ctx.getImageData(0, 16, SIZE, 34).data.filter((_, i) => i % 4 === 0);
  // A clone given the UA's border or background as author styles draws a green fallback bar.
  // The native bars are different blues (Firefox's darker than Chromium's, WebKit's rgb(52,132,228)).
  expect(blue > 150 && green < 180 && red < 80).toBe(true);
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
  // The dark backdrop, then the play button (greyed until metadata loads) and the timeline over it.
  expect(Math.max(...at(5, 55))).toBeLessThan(64);
  expect(Math.min(...at(25, 52))).toBeGreaterThan(64);
  expect(Math.min(...at(50, 78))).toBeGreaterThan(64);
});

/** 16x16 VP8 WebM: a red frame, then a blue one from 0.1 s. */
const CLIP =
  "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAH0EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggETTbuMU6uEHFO7a1OsggHe7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRMYXZmV0GETGF2ZkSJiEBpAAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAX14QDgkLCBELqBEJqBAlWwhFW5gQESVMNn0HNzzWPAi2PFiAAAAAAAAAABZ8iYRaOHRU5DT0RFUkSHi0xhdmMgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4yMDAwMDAwMDAAH0O2dfHngQCjvYEAAIDwAgCdASoQABAAAEcIhYWIhYSIAgICdaoD+AP6Ag1NGAD+/W7z/+OZNzDE/45t//FhPA4oyP/xUQCjrYEAZACxAQABEBAAGAAwP/QMAAAA/v9NEv/8WE8DijI//FhX/z8oL6sr636JABxTu2uRu4+zgQC3iveBAfGCAWjwgQM=";

it("encodes a paused video's frame once while it stays where it is", async () => {
  const { win, rasterizer } = await frameOf(`<video controls preload="auto" width=64 height=64 src="${CLIP}"></video>`);
  const video = win.document.querySelector("video") as HTMLVideoElement;
  const still = () => video.readyState >= 2 && !video.seeking;
  await vi.waitUntil(still, { timeout: 5000 });
  const encode = vi.spyOn((win as Window & typeof globalThis).HTMLCanvasElement.prototype, "toDataURL");
  await rasterizer.snapshot();
  const { svg } = await rasterizer.snapshot();
  expect(encode).toHaveBeenCalledTimes(1);
  expect(svg).toContain(encode.mock.results[0]?.value);
  // Moved to another frame, it is encoded again.
  video.currentTime = 0.15;
  await vi.waitUntil(still, { timeout: 5000 });
  await rasterizer.snapshot();
  expect(encode).toHaveBeenCalledTimes(2);
  encode.mockRestore();
});
