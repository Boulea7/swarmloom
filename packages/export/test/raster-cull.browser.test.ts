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

/** Draws the frame and returns a reader of RGB pixels. */
async function drawn(rasterizer: FrameRasterizer): Promise<(x: number, y: number) => number[]> {
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  await rasterizer.draw(ctx);
  return (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

it("leaves out what is far from the viewport, keeping layout and what reaches into view", async () => {
  const { win, rasterizer } = await frameOf(`<body style="margin:0">
    <section style="height:600px;padding:1px;background:rgb(0,0,255)"><p>far above</p></section>
    <section style="height:400px;padding:1px"><p>near</p></section>
    <section style="height:98px;padding:1px;background:rgb(255,0,0)"></section>
    <div style="position:absolute;top:2000px"><p>far below</p></div>
    <div style="position:absolute;top:2000px"><b style="position:absolute;top:-980px;display:block;width:50px;height:50px;background:rgb(0,255,0)"></b></div>
  </body>`);
  win.scrollTo(0, 1004);
  const { svg, stats } = await rasterizer.snapshot();
  expect(svg).not.toMatch(/far (above|below)/);
  // The empty box keeps what sets its size and place only: nothing of it shows.
  expect(svg).not.toContain("0, 0, 255");
  expect(svg).toContain(">near<");
  expect(stats.culled).toBe(2);
  // The first section went empty but kept its height: the red one is still in view.
  const at = await drawn(rasterizer);
  expect({ red: at(75, 50), green: at(25, 40) }).toEqual({ red: [255, 0, 0], green: [0, 255, 0] });
});

it("leaves out boxes under a frame that covers the viewport", async () => {
  const { rasterizer } = await frameOf(`<body style="margin:0">
    <div style="position:fixed;inset:0;background:rgb(255,0,0)">covered</div>
    <iframe srcdoc="<body style='margin:0;background:rgb(0,0,255)'>over</body>"
      style="position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;border:0;z-index:1"></iframe>
  </body>`);
  const { svg } = await rasterizer.snapshot();
  expect(svg).not.toContain("covered");
  expect(svg).toContain(">over<");
  expect((await drawn(rasterizer))(90, 90)).toEqual([0, 0, 255]);
});

it("embeds an image used many times once for images and once for CSS", async () => {
  const canvas = new OffscreenCanvas(2, 1);
  const g = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  g.fillStyle = "rgb(255,0,0)";
  g.fillRect(0, 0, 1, 1);
  g.fillStyle = "rgb(0,255,0)";
  g.fillRect(1, 0, 1, 1);
  const blob = await canvas.convertToBlob();
  const url = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  // Crops of one bitmap, as rendered pages give them: the image shifted inside a clipping box.
  const crop = (left: number) =>
    `<div style="position:relative;overflow:hidden;width:30px;height:30px;flex:none">` +
    `<img src="${url}" style="position:absolute;left:${left}px;top:0;width:60px;height:30px;image-rendering:pixelated"></div>`;
  const { rasterizer } = await frameOf(
    `<body style="margin:0"><div style="display:flex">${crop(0)}${crop(-30)}` +
      `<div style="width:30px;height:30px;background:url(${url}) 0 0/60px 30px;image-rendering:pixelated"></div></div>`,
  );
  const { svg } = await rasterizer.snapshot();
  expect(svg.split(url.slice(30, 90)).length - 1).toBe(2);
  // Chromium decodes an image again for every element that gets its URL through var().
  expect(svg).not.toContain("content:var(");
  const at = await drawn(rasterizer);
  expect([at(15, 15), at(45, 15), at(75, 15)]).toEqual([
    [255, 0, 0],
    [0, 255, 0],
    [255, 0, 0],
  ]);
});

it("draws the topmost canvas over the image instead of encoding it", async () => {
  // As in the render page: the body clips but holds only fixed boxes, so it has no height.
  const { win, rasterizer } = await frameOf(`<html style="overflow:hidden">
    <body style="margin:0;overflow:hidden;background:rgb(0,0,255)">
    <div style="position:fixed;inset:0;overflow:hidden"><canvas width=${SIZE} height=${SIZE}
      style="position:absolute;left:0;top:0"></canvas><div style="position:absolute;inset:0"></div></div></body>`);
  const canvas = win.document.querySelector("canvas") as HTMLCanvasElement;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "rgb(0,255,0)";
  g.fillRect(0, 0, 50, SIZE);
  const { svg, overlays } = await rasterizer.snapshot();
  expect(overlays.map((o) => o.canvas)).toEqual([canvas]);
  expect(svg).not.toContain("image/png");
  const at = await drawn(rasterizer);
  expect([at(25, 50), at(75, 50)]).toEqual([
    [0, 255, 0],
    [0, 0, 255],
  ]);
});

it("draws the canvases painted last over the image, a scaled one under the topmost", async () => {
  // As in the render page: a WebGL model in a scaled world of z-indexed layers, the cursor canvas over it.
  const { win, rasterizer } = await frameOf(`<html style="overflow:hidden">
    <body style="margin:0;overflow:hidden;background:rgb(0,0,255)">
    <div style="position:fixed;inset:0;overflow:hidden">
      <div style="position:absolute;left:0;top:0;transform:matrix(0.5,0,0,0.5,50,0);transform-origin:0 0;isolation:isolate">
        <i style="position:absolute;z-index:1"></i>
        <div style="position:absolute;z-index:2"><canvas width=${SIZE} height=${SIZE}
          style="position:absolute;left:0;top:0"></canvas></div>
      </div>
      <canvas width=${SIZE} height=${SIZE} style="position:absolute;left:0;top:0"></canvas></div></body>`);
  const [model, cursors] = Array.from(win.document.querySelectorAll("canvas"));
  const fill = (canvas: HTMLCanvasElement | undefined, color: string, width: number) => {
    const g = canvas?.getContext("2d") as CanvasRenderingContext2D;
    g.fillStyle = color;
    g.fillRect(0, 0, width, SIZE);
  };
  fill(model, "rgb(0,255,0)", SIZE);
  fill(cursors, "rgb(255,0,0)", 25);
  const { svg, overlays } = await rasterizer.snapshot();
  expect(overlays.map((o) => o.canvas)).toEqual([model, cursors]);
  expect(svg).not.toContain("image/png");
  const at = await drawn(rasterizer);
  expect([at(10, 25), at(40, 25), at(75, 25), at(75, 75)]).toEqual([
    [255, 0, 0],
    [0, 0, 255],
    [0, 255, 0],
    [0, 0, 255],
  ]);
  // A layer above the model's, written before it, would paint over it: the model goes into the image.
  (win.document.querySelector("i") as HTMLElement).style.zIndex = "3";
  expect((await rasterizer.snapshot()).overlays.map((o) => o.canvas)).toEqual([cursors]);
});

it("walks in slices and starts over when the page changes meanwhile", async () => {
  const cells = Array.from({ length: 1500 }, () => '<i style="display:block;width:1px;height:1px"></i>').join("");
  const { win, rasterizer } = await frameOf(
    `<body style="margin:0"><div style="display:flex;flex-wrap:wrap">${cells}</div><p id=p>before</p></body>`,
  );
  // Runs between two slices of the walk.
  setTimeout(() => {
    (win.document.getElementById("p") as HTMLElement).textContent = "after";
  });
  const { svg, stats } = await rasterizer.snapshot();
  expect(stats.restarts).toBeGreaterThan(0);
  expect(svg).toContain("after");
});
