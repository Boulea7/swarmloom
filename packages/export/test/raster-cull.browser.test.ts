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
  // As the export does through player.ready(): Firefox may dispatch srcdoc's initial loadingdone
  // after load, which otherwise invalidates the first far-box cache on a slower test runner.
  await win.document.fonts.ready;
  return { win, rasterizer: rasterizerOf(win) };
}

/** A new rasterizer reading `win`'s document, remembering nothing of earlier walks. */
function rasterizerOf(win: Window): FrameRasterizer {
  return new FrameRasterizer({
    document: win.document,
    width: SIZE,
    height: SIZE,
    shadows: { roots: () => [], stop() {} },
    fonts: { faces: () => [], stop() {} },
  });
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
    <section style="height:400px;padding:1px"><p style="margin-top:350px">near</p></section>
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

it("writes far boxes empty inside wrappers, lines and tables, keeping where the rest lands", async () => {
  // Four boxes, the first three far above the view, then a red marker laid out by the same parent.
  const items = (item: (i: number) => string, red: string) => `${[0, 1, 2, 3].map(item).join("")}${red}`;
  const red = "background:rgb(255,0,0)";
  const sections = items(
    (i) => `<section style="height:300px;padding:1px"><p>far ${i}</p></section>`,
    `<p id=red style="height:98px;margin:0;${red}"></p>`,
  );
  const cases = {
    contents: `<div style="display:contents">${sections}</div>`,
    "custom element": `<app-root>${sections}</app-root>`,
    "inline blocks": `<div>${items(
      (i) => `<span style="display:inline-block;vertical-align:top;width:90px;height:300px">far ${i}</span>`,
      `<span id=red style="display:inline-block;vertical-align:top;width:90px;height:98px;${red}"></span>`,
    )}</div>`,
    table: `<table style="border-collapse:collapse">${items(
      (i) => `<tr><td style="height:300px;border:1px solid">far ${i}</td></tr>`,
      `<tr><td id=red style="height:98px;width:90px;padding:0;${red}"></td></tr>`,
    )}</table>`,
  };
  for (const [name, html] of Object.entries(cases)) {
    const { win, rasterizer } = await frameOf(`<!doctype html><body style="margin:0">${html}`);
    const marker = win.document.getElementById("red") as HTMLElement;
    win.scrollTo(0, marker.getBoundingClientRect().top - 20);
    const { svg, stats } = await rasterizer.snapshot();
    expect({ name, far: svg.includes("far 0"), culled: stats.culled > 0 }).toEqual({ name, far: false, culled: true });
    const at = await drawn(rasterizer);
    expect({ name, above: at(50, 17), top: at(50, 22) }).toEqual({ name, above: [255, 255, 255], top: [255, 0, 0] });
  }
});

// 384 boxes of 30.515625 px compute as `30.5156px`, which Chromium lays out as 30.5: written one by
// one, they would move what follows them 6 px up.
it.for<[string, string, (i: number) => string, boolean]>([
  ["siblings", "", (i) => `<section style="height:30.515625px">far ${i}</section>`, true],
  // A float before them pushes boxes that hold their content in below it, not one block written for all.
  [
    "after a float",
    '<div style="float:left;width:100px;height:300px"></div>',
    (i) => `<section style="display:flow-root;width:60px;height:30.515625px">far ${i}</section>`,
    false,
  ],
])("writes a run of far boxes as one empty box where it lays out the same: %s", async ([, before, item, merged]) => {
  const items = Array.from({ length: 384 }, (_, i) => item(i)).join("\n");
  const { win, rasterizer } = await frameOf(
    `<!doctype html><body style="margin:0">${before}${items}<p id=red style="height:98px;margin:0;background:rgb(255,0,0)"></p>`,
  );
  const red = win.document.getElementById("red") as HTMLElement;
  win.scrollTo(0, red.getBoundingClientRect().top - 20);
  const { svg } = await rasterizer.snapshot();
  expect((svg.match(/<section/g)?.length ?? 0) < 20).toBe(merged);
  const at = await drawn(rasterizer);
  expect({ above: at(50, 18), top: at(50, 21) }).toEqual({ above: [255, 255, 255], top: [255, 0, 0] });
});

it("paints nothing of a box written empty, wherever its transform put it", async () => {
  const { rasterizer } = await frameOf(`<body style="margin:0;color:rgb(255,0,0)">
    <div style="height:40px;padding:1px;border:10px solid;transform:translateY(-3000px)"><p>moved away</p></div></body>`);
  const { svg, stats } = await rasterizer.snapshot();
  expect({ moved: svg.includes("moved away"), culled: stats.culled }).toEqual({ moved: false, culled: 1 });
  expect((await drawn(rasterizer))(5, 5)).toEqual([255, 255, 255]);
});

// No border or padding anywhere: headings', paragraphs' and quotes' margins collapse through.
it.for<[string, (i: number) => string]>([
  // The h2's margin passes the section's top; the quote's bottom ones stay within its own.
  [
    "sections",
    (i) => `<section style="margin:16px 0"><h2>far ${i}</h2><p>text <em>x</em></p>
      <ul><li>a</li><li>b</li></ul><blockquote><p>q</p></blockquote></section>`,
  ],
  // Through an inline custom element and both edges (the bottom read through CSS Typed OM).
  ["wrapped", (i) => `<div><x-card><h3>far ${i}</h3><p>text</p></x-card></div>`],
  // A set height holds the paragraph's margin in: passed on by any block, it would move the red box.
  [
    "wrapped in a set height",
    (i) => `<div style="height:80px"><x-card><h3>far ${i}</h3><p style="margin-bottom:40px">text</p></x-card></div>`,
  ],
])(
  "writes far article blocks empty, with the margins their content shares with them: %s",
  async ([name, item], { skip }) => {
    // Without CSS Typed OM no height reads as `auto`: the last written block keeps the margin in (a known limit).
    skip(server.browser === "firefox" && name === "wrapped", "Firefox lacks CSS Typed OM");
    const items = Array.from({ length: 8 }, (_, i) => item(i)).join("");
    const { win, rasterizer } = await frameOf(
      `<!doctype html><body style="margin:0">${items}<p id=red style="height:98px;margin:0;background:rgb(255,0,0)"></p>`,
    );
    const red = win.document.getElementById("red") as HTMLElement;
    win.scrollTo(0, red.getBoundingClientRect().top - 20);
    const { svg, stats } = await rasterizer.snapshot();
    expect({ far: svg.includes("far 0"), culled: stats.culled >= 4 }).toEqual({ far: false, culled: true });
    const at = await drawn(rasterizer);
    expect({ above: at(50, 18), top: at(50, 21) }).toEqual({ above: [255, 255, 255], top: [255, 0, 0] });
  },
);

it("reads each box of a deep wrapper chain once for the margins passed through it", async () => {
  // Framework markup: a paragraph's bottom margin collapses through every plain wrapper around it.
  const depth = 40;
  const { win, rasterizer } = await frameOf(
    `<body style="margin:0">${"<div>".repeat(depth)}<p style="margin:0 0 30px">deep</p>${"</div>".repeat(depth)}`,
  );
  const read = win.getComputedStyle.bind(win);
  let afters = 0;
  win.getComputedStyle = (el, pseudo) => {
    if (pseudo === "::after") afters++;
    return read(el, pseudo);
  };
  const { svg, stats } = await rasterizer.snapshot();
  expect(svg).toContain(">deep<");
  // Once to write it, once for its bottom edge per walk: a font load may legitimately restart one.
  expect(afters).toBeLessThan(3 * depth * (stats.restarts + 1));
});

it("reads what overflows a far box once for the boxes in flow in it, drawing what reaches into view", async () => {
  // A pseudo-element of a box deep in a far one reaches into view: only the far box's scroll size tells.
  const reach = `<div style="height:10px"><div><div class=reach></div></div></div>`;
  const card = (i: number) =>
    `<section style="height:40px"><h3>far ${i}</h3><div><p>text</p><p>more</p></div></section>`;
  const cards = Array.from({ length: 6 }, (_, i) => card(i)).join("");
  const { win, rasterizer } = await frameOf(`<!doctype html><style>h3,p{margin:0}
    .reach{display:flow-root;height:10px}
    .reach::after{content:"";display:block;width:50px;height:50px;margin-top:1010px;background:rgb(255,0,0)}
    </style><body style="margin:0">${reach}${cards}<div style="height:3000px"></div>${cards}`);
  win.scrollTo(0, 1000);
  let reads = 0;
  const proto = (win as Window & typeof globalThis).Element.prototype;
  for (const name of ["scrollWidth", "scrollHeight"] as const) {
    const { get } = Object.getOwnPropertyDescriptor(proto, name) as PropertyDescriptor;
    Object.defineProperty(proto, name, {
      configurable: true,
      get() {
        reads++;
        return get?.call(this);
      },
    });
  }
  const { svg } = await rasterizer.snapshot();
  expect(svg).not.toContain("far ");
  // The six far cards above the view once each, the chain reaching into view once a box; none below.
  expect(reads).toBeLessThanOrEqual(12);
  expect((await drawn(rasterizer))(25, 30)).toEqual([255, 0, 0]);
});

it("writes far boxes empty around SVG ids, keeping the clip paths, gradients and symbols drawn elsewhere", async () => {
  // Cards as design tools export their icons: a clip path or gradient with an id inside each.
  const icon = (i: number) =>
    `<svg width=20 height=20><g clip-path="url(#clip${i})"><rect width=20 height=20 /></g><defs>` +
    `<clipPath id=clip${i}><rect width=10 height=10 /></clipPath></defs></svg>`;
  const card = (i: number, defs = "") =>
    `<div style="border:1px solid;padding:4px;height:150px">${icon(i)}${defs}<p>far ${i}</p></div>`;
  const defs =
    '<svg width=0 height=0><linearGradient id=g><stop stop-color="rgb(0,255,0)"/></linearGradient>' +
    '<symbol id=s viewBox="0 0 1 1"><rect width=1 height=1 fill="rgb(0,0,255)"/></symbol></svg>';
  const { win, rasterizer } = await frameOf(`<!doctype html><body style="margin:0">
    ${card(0, defs)}${[1, 2, 3, 4, 5].map((i) => card(i)).join("")}<div style="height:300px"></div>
    <svg width=100 height=100 style="display:block" id=view><rect width=50 height=50 fill="url(#g)" />
      <use href="#s" x=50 width=50 height=50 />
      <rect transform="translate(0 50)" width=50 height=50 fill="rgb(255,0,0)" clip-path="url(#clip0)" /></svg>
  </body>`);
  win.scrollTo(0, (win.document.getElementById("view") as Element).getBoundingClientRect().top);
  const { svg, stats } = await rasterizer.snapshot();
  expect({ far: svg.includes("far"), culled: stats.culled }).toEqual({ far: false, culled: 6 });
  // What nothing written refers to stays out.
  expect(svg.match(/<clipPath/g)?.length).toBe(1);
  const at = await drawn(rasterizer);
  expect({ gradient: at(25, 25), symbol: at(75, 25), clipped: at(5, 55), outside: at(25, 75) }).toEqual({
    gradient: [0, 255, 0],
    symbol: [0, 0, 255],
    clipped: [255, 0, 0],
    outside: [255, 255, 255],
  });
});

it("keeps what escapes a clipping or transparent box away from view: fixed boxes and SVG resources", async () => {
  const { win, rasterizer } = await frameOf(`<body style="margin:0">
    <div style="position:absolute;width:0;height:0;overflow:hidden"><svg>
      <linearGradient id=g><stop stop-color="rgb(0,255,0)"/></linearGradient></svg></div>
    <div style="position:absolute;opacity:0"><svg width=0 height=0>
      <symbol id=s viewBox="0 0 1 1"><rect width=1 height=1 fill="rgb(0,0,255)"/></symbol></svg></div>
    <div style="position:absolute;width:10px;height:10px;overflow:hidden"><p>clipped away</p></div>
    <main style="height:1000px"></main>
    <svg width=50 height=50 style="display:block"><rect width=50 height=50 fill="url(#g)"/></svg>
    <svg width=50 height=50 style="display:block"><use href="#s" width=50 height=50 /></svg>
    <footer style="position:relative;overflow:hidden;height:200px;margin-top:2000px">
      <a style="position:fixed;right:0;bottom:0;width:40px;height:30px;display:block;background:rgb(255,0,0)"></a></footer>
  </body>`);
  win.scrollTo(0, 1000);
  const { svg } = await rasterizer.snapshot();
  expect(svg).not.toContain("clipped away");
  const at = await drawn(rasterizer);
  expect({ gradient: at(25, 25), symbol: at(25, 75), fixed: at(80, 85) }).toEqual({
    gradient: [0, 255, 0],
    symbol: [0, 0, 255],
    fixed: [255, 0, 0],
  });
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

it("shows what is under a frame whose page has no background, unless the page takes another colour scheme", async () => {
  // As Chromium draws the go-live tail: the render page takes both schemes, the live page light.
  for (const [childHead, under, color] of [
    ["", true, [255, 200, 0]],
    ["<meta name=color-scheme content=dark>", false, [18, 18, 18]],
  ] as const) {
    const { rasterizer } = await frameOf(`<meta name="color-scheme" content="light dark"><body style="margin:0">
      <div style="position:fixed;inset:0;background:rgb(255,200,0)">beneath</div>
      <iframe srcdoc="${childHead}<body style='margin:0'>live</body>"
        style="position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;border:0;z-index:1"></iframe>
    </body>`);
    const { svg } = await rasterizer.snapshot();
    expect(svg.includes(">beneath<")).toBe(under);
    expect((await drawn(rasterizer))(90, 90)).toEqual(color);
  }
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

/** Pauses an animation `time` ms in. */
function paused(animation: Animation, time: number): Animation {
  animation.pause();
  animation.currentTime = time;
  return animation;
}

const nearHeight = (win: Window, timing: KeyframeAnimationOptions = { duration: 1000 }) =>
  (win.document.getElementById("near") as HTMLElement).animate([{ height: "98px" }, { height: "40px" }], timing);

// What changes between two walks of a long page (after `setup`, before both): the far cards it
// leaves alone are written as the last walk wrote them, and the frame comes out as a new
// rasterizer writes it. The even cards hold their content in; the odd ones' content would flow
// around a float before them, which any change in the page may move.
it.for<[string, (win: Window) => void, "all" | "even" | "none", ((win: Window) => void)?]>([
  ["nothing", () => {}, "all"],
  // A paint-only animation in view, as after going live: only its own box is read again.
  [
    "an animation in view",
    (win) =>
      paused((win.document.getElementById("near") as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], 1000), 500),
    "all",
  ],
  // It paints the body's own box only, not the cards in it.
  [
    "an animation of the page's background",
    (win) =>
      paused(
        win.document.body.animate([{ backgroundColor: "rgb(255,255,255)" }, { backgroundColor: "rgb(0,0,255)" }], 1000),
        500,
      ),
    "all",
  ],
  // Layout in view, as a mutation of its style: the far cards stay where they were.
  ["a layout animation in view", (win) => paused(nearHeight(win), 500), "all"],
  [
    "a step of a stepped animation that changes no value",
    (win) => {
      for (const animation of win.document.getAnimations()) animation.currentTime = 200;
    },
    "all",
    (win) => paused(nearHeight(win, { duration: 1000, easing: "steps(2)" }), 100),
  ],
  // Container queries may restyle any box after a layout change.
  [
    "a layout animation under container queries",
    (win) => paused(nearHeight(win), 500),
    "none",
    (win) =>
      win.document.head.insertAdjacentHTML("beforeend", "<style>@container (width > 0) { h3 { color: red } }</style>"),
  ],
  // The far boxes keep their size, but their percentage margins follow the width of the page
  // around them, which follows the box animated in view.
  [
    "a layout animation that resizes what the far boxes' margins resolve against",
    (win) =>
      paused(
        (win.document.getElementById("near") as HTMLElement).animate([{ width: "100px" }, { width: "300px" }], 1000),
        500,
      ),
    "none",
    (win) =>
      win.document.head.insertAdjacentHTML(
        "beforeend",
        `<style>body { display: inline-block; vertical-align: top } section > * { display: none }
          section, div { width: 50px; margin-top: 10% } #near { width: 100px }</style>`,
      ),
  ],
  // Container units resolve against a container another box may resize, as container queries do.
  [
    "a layout animation under container units",
    (win) => paused(nearHeight(win), 500),
    "none",
    (win) => win.document.head.insertAdjacentHTML("beforeend", "<style>h3 { margin-top: 1cqi }</style>"),
  ],
  ["the scroll", (win) => win.scrollBy(0, 60), "all"],
  [
    "a far card's text",
    (win) => ((win.document.getElementById("c3") as HTMLElement).textContent = "x".repeat(500)),
    "all",
  ],
  ["a far card's height", (win) => ((win.document.getElementById("c1") as HTMLElement).style.height = "220px"), "all"],
  [
    "a far card's height after a float",
    (win) => ((win.document.getElementById("c1") as HTMLElement).style.height = "220px"),
    "even",
    (win) =>
      win.document.body.insertAdjacentHTML("afterbegin", '<div style="float:left;width:10px;height:10px"></div>'),
  ],
  // Every box inherits it.
  ["the page's color", (win) => (win.document.body.style.color = "rgb(0,0,255)"), "none"],
])("writes far boxes again from the last walk until they change: %s", async ([name, change, reused, setup]) => {
  const card = (i: number) =>
    `<section id=c${i} style="height:100px;border:1px solid${i % 2 ? "" : ";display:flow-root"}"><h3>far ${i}</h3><p>text</p></section>`;
  const cards = Array.from({ length: 40 }, (_, i) => card(i)).join("");
  const { win, rasterizer } = await frameOf(`<!doctype html><body style="margin:0">${cards}
    <p id=near style="height:98px;margin:0;background:rgb(255,0,0)"></p><div style="height:2000px"></div>`);
  setup?.(win);
  // A style element added fires its load a task later, a change of the sheets for any walk after.
  await new Promise((resolve) => setTimeout(resolve));
  win.scrollTo(0, 4060);
  await rasterizer.snapshot();
  change(win);
  const { svg, stats } = await rasterizer.snapshot();
  const fresh = await rasterizerOf(win).snapshot();
  const count = stats.reused;
  const which = count === 0 ? "none" : count > 30 ? "all" : count >= 15 ? "even" : String(count);
  expect({ name, same: svg === fresh.svg, reused: which }).toEqual({ name, same: true, reused });
});

it("reads anew what the selectors reach after a rule is replaced in place by as many", async () => {
  const cards = Array.from(
    { length: 40 },
    (_, i) => `<section style="height:100px;display:flow-root"><p>far ${i}</p></section>`,
  );
  const { win, rasterizer } = await frameOf(`<!doctype html><style>section { margin-bottom: 0 }</style>
    <body style="margin:0">${cards.join("")}<p id=near style="height:98px;margin:0"></p><div style="height:2000px"></div>`);
  win.scrollTo(0, 4000);
  await drawn(rasterizer);
  // The rule count stays: only the still check of a drawn frame sees the edit.
  const sheet = win.document.styleSheets[0] as CSSStyleSheet;
  sheet.deleteRule(0);
  sheet.insertRule("body:has(.x) section { margin-bottom: 80px }", 0);
  await drawn(rasterizer);
  // A change in view now restyles every card.
  (win.document.getElementById("near") as HTMLElement).className = "x";
  const { svg, stats } = await rasterizer.snapshot();
  const fresh = await rasterizerOf(win).snapshot();
  expect({ same: svg === fresh.svg, reused: stats.reused }).toEqual({ same: true, reused: 0 });
});
