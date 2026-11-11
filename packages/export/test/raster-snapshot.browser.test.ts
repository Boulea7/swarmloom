import { afterEach, expect, it } from "vitest";
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

it("draws a scrolled document at its scroll offset once", async () => {
  const bands = Array.from({ length: 8 }, (_, i) => `<div style="height:100px;background:rgb(${i * 30},0,0)"></div>`);
  const { win, rasterizer } = await frameOf(`<!doctype html><body style="margin:0">${bands.join("")}</body>`);
  win.scrollTo(0, 300);
  expect(await pixel(rasterizer, 5, 5)).toEqual([90, 0, 0]);
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
