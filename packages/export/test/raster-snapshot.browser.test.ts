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

/** Draws the frame and returns all its pixels. */
async function pixels(rasterizer: FrameRasterizer): Promise<Uint8ClampedArray> {
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  await rasterizer.draw(ctx);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
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

/** A box scrolled 40px down (`#s`), 60px tall, holding `content` and room to scroll. */
const scroller = (style: string, content: string) =>
  `<div id=s style="height:60px;overflow:hidden;${style}">${content}<div style="height:200px"></div></div>`;
const square = (style: string) => `<i style="width:20px;height:20px;background:rgb(0,255,0);${style}"></i>`;

it.each([
  // `translate` moves no inline box: the spans of a scrolled code block stayed behind its text.
  [
    "an inline child",
    scroller("", '<div style="height:40px"></div><span style="color:rgb(0,0,255);background:rgb(0,0,255)">MM</span>'),
    10,
    10,
    [0, 0, 255],
  ],
  ["a fixed child, not scrolled", scroller("", square("position:fixed;left:50px;top:10px")), 60, 20, [0, 255, 0]],
  [
    "an absolute child of an unpositioned box, not scrolled",
    scroller("", square("position:absolute;left:50px;top:70px")),
    60,
    80,
    [0, 255, 0],
  ],
  [
    "an absolute child of a positioned box",
    scroller("position:relative", square("position:absolute;top:50px")),
    10,
    20,
    [0, 255, 0],
  ],
  // White space wrapped to move became flex items, with gaps around them.
  [
    "flex items, without the white space between them",
    scroller(
      "display:flex;flex-direction:column;gap:20px",
      ` <b style="flex:none;height:40px"></b> ${square("flex:none;height:40px")} `,
    ),
    10,
    30,
    [0, 255, 0],
  ],
  [
    "a pseudo-element",
    `<style>#s::before{content:"";display:block;height:20px;margin-top:40px;background:rgb(0,255,0)}</style>${scroller("", "")}`,
    10,
    10,
    [0, 255, 0],
  ],
  [
    "a textarea's text",
    '<textarea id=s style="display:block;border:0;padding:0;width:100px;height:40px;overflow:hidden;' +
      'font:20px/20px monospace;color:rgb(255,0,0)">\n\n\n\u2588\u2588\nx\nx\nx</textarea>',
    5,
    10,
    [255, 0, 0],
  ],
])("draws scrolled content where the page shows it: %s", async (_name, html, x, y, expected) => {
  const { win, rasterizer } = await frameOf(`<body style="margin:0;font:20px/20px monospace">${html}`);
  (win.document.getElementById("s") as HTMLElement).scrollTop = 40;
  expect(await pixel(rasterizer, x, y)).toEqual(expected);
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
  // A reset clone moves both origins back to the centre, where these boxes shrink away from (2, 2).
  ["a transform about the top left corner", '<div style="transform-origin:0 0;scale:0.5;height:100px">', [0, 0, 255]],
  [
    "a perspective from the top left corner",
    '<section style="perspective:100px;perspective-origin:0 0"><div style="transform:translateZ(-100px);height:100px">',
    [0, 0, 255],
  ],
  [
    "an SVG transform about the user space origin",
    '<svg width=100 height=100 style="display:block"><rect width=100 height=100 transform="scale(0.5)" fill="rgb(0,0,255)"/></svg>',
    [0, 0, 255],
  ],
])("draws %s", async (_name, html, expected) => {
  const { rasterizer } = await frameOf(`<style>body{margin:0}div{background:rgb(0,0,255)}</style>${html}`);
  expect(await pixel(rasterizer, 2, 2)).toEqual(expected);
});

it.for([
  // The paragraph's margin collapses through the div's bottom; a clone sized to the div kept it inside.
  ["passes on through an auto height", ""],
  // Here it stays inside on the page too: passed on, it would push the red box down.
  ["holds in with a set height", "height:40px"],
  // A float's auto height takes it in too (a block formatting context): passed on, it pushes the cleared box down.
  ["holds in a float", "float:left;width:100%"],
])("places what follows a written block by the margin its last content %s", async ([_name, height], { skip }) => {
  // Without CSS Typed OM no height reads as `auto`: the margin stays inside (a known limit).
  skip(server.browser === "firefox" && !height, "Firefox lacks CSS Typed OM");
  const block = `<div style="${height}"><x-text><p style="margin:0 0 30px">x</p>\n</x-text></div>`;
  const { win, rasterizer } = await frameOf(
    `<body style="margin:0">${block}<div id=red style="clear:both;height:50px;background:rgb(255,0,0)"></div></body>`,
  );
  const top = Math.round((win.document.getElementById("red") as HTMLElement).getBoundingClientRect().top);
  expect([await pixel(rasterizer, 50, top - 2), await pixel(rasterizer, 50, top + 1)]).toEqual([
    [255, 255, 255],
    [255, 0, 0],
  ]);
});

it("writes one href for an SVG element that has both href and xlink:href", async () => {
  const { rasterizer } = await frameOf(
    '<body style="margin:0"><svg width=50 height=50 style="display:block">' +
      '<defs><rect id=r width=50 height=50 fill="rgb(255,0,0)"/></defs><use href="#r" xlink:href="#r"/></svg></body>',
  );
  // A duplicate attribute makes the SVG ill-formed, so it would not decode.
  expect(await pixel(rasterizer, 5, 5)).toEqual([255, 0, 0]);
});

/**
 * `box` far above the view, then a paragraph that shows the counter `name` in its scope: as the
 * page counts it, or `shown`, the number the page should show, written out.
 */
const numbered = (box: string, name: string, shown?: string) =>
  "<style>body{margin:0;font:10px/10px monospace}ol,ul{margin:0}.far{position:absolute;top:-3000px}" +
  `p::before{content:${shown === undefined ? `counter(${name})` : `"${shown}"`}}</style>` +
  `${box}<div style=height:400px></div><p></p>`;

/** An ordered list: 30 items in a wrapper, between `open` and `close`, then two more. */
const list = (open = "", close = "") =>
  `<ol><div style="padding:1px 0">${open}${"<li>i".repeat(30)}${close}</div><li>i<li>i</ol>`;

/** Far boxes that reset, step and set a counter: 4, then 7 and 20 (the set comes last), then 24. */
const section = (h2 = "<h2>") => `<section>${h2}S</h2></section>`;
const sections =
  "<style>section{display:flow-root;height:200px}h2{counter-increment:s}h2::before{content:counter(s)}</style>" +
  `<div style="counter-reset:s 4">i</div>${section().repeat(3)}` +
  `${section('<h2 style="counter-set:s 20">')}${section().repeat(4)}`;

it.each([
  ["explicit counters", sections, "s", /<h2/g, 8, "24"],
  ["list items of the outer list", list(), "list-item", /<li/g, 32, "32"],
  // Items of a list of their own number nothing after it: their wrapper still goes empty.
  ["a list of its own", list("<ul>", "</ul>"), "list-item", /<li/g, 2, "2"],
  // A box's own reset numbers the boxes after it, a list's items step its counter for them too.
  ["a reset out of flow", '<div class=far style="counter-reset:n 4">i</div>', "n", />i</g, 1, "4"],
  ["a list out of flow", "<ol class=far start=4><li>i</ol>", "list-item", /<li/g, 1, "4"],
  ["the items of a far list", `<ol style=display:flow-root>${"<li>i".repeat(30)}</ol>`, "list-item", /<li/g, 30, "30"],
])("keeps the counters of off-screen content: %s", async (_name, box, name, tag, count, shown) => {
  const drawn = async (html: string) => {
    const { win, rasterizer } = await frameOf(html);
    win.scrollTo(0, win.document.documentElement.scrollHeight);
    return { svg: (await rasterizer.snapshot()).svg, pixels: await pixels(rasterizer) };
  };
  const page = await drawn(numbered(box, name));
  const written = await drawn(numbered(box, name, shown));
  // The snapshot counts again: a box or a counter left out would change the number in view.
  expect(page.svg.match(tag)).toHaveLength(count);
  expect(page.pixels.filter((value, i) => value !== written.pixels[i])).toHaveLength(0);
});

it("writes live form state without duplicating authored attributes", async () => {
  const { win, rasterizer } = await frameOf(
    "<input value=Go id=t><input type=checkbox checked id=c><select id=s><option>A<option selected>B</select>",
  );
  const byId = <T extends HTMLElement>(id: string) => win.document.getElementById(id) as T;
  // Each control moves away from its authored state: the snapshot has to write what the page shows.
  byId<HTMLInputElement>("t").value = "Hi";
  byId<HTMLInputElement>("c").checked = false;
  byId<HTMLSelectElement>("s").value = "A";
  const { svg } = await rasterizer.snapshot();
  expect(svg).not.toContain("checked");
  expect(svg).toContain(' value="Hi"');
  expect(svg).not.toContain('"Go"');
  expect(svg.match(/<option[^>]*>/g)?.map((tag) => tag.includes(' selected="selected"'))).toEqual([true, false]);
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
  // Only the field's own rows: Firefox's progress box is 18px tall, and its blue bar has no red.
  const field = (win.document.querySelector("input") as HTMLElement).getBoundingClientRect();
  const top = Math.ceil(field.top);
  const text = ctx.getImageData(0, top, SIZE, Math.floor(field.bottom) - top).data.filter((_, i) => i % 4 === 0);
  // A clone given the UA's border or background as author styles draws a green fallback bar.
  // The native bars are different blues (Firefox's darker than Chromium's, WebKit's rgb(52,132,228)).
  expect(blue > 150 && green < 180 && red < 80).toBe(true);
  // A resolved text fill colour on the root clone, inherited down to the placeholder, drew it black;
  // a blank field would pass that alone, so the grey glyphs must be there too (about 1200 pixels).
  expect(Math.min(...text)).toBeGreaterThan(80);
  expect(text.filter((red) => red < 240).length).toBeGreaterThan(200);
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

/** A `type` data URL of `width` x `height` px: blue under grey noise, so that it compresses badly. */
async function noisy(width: number, height: number, type: string): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  const image = ctx.createImageData(width, height);
  let seed = 1;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const n = seed >>> 26;
    image.data.set([n, n, 192 + n, 255], i);
  }
  ctx.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type, quality: 0.9 });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

it("embeds a large photo only as large as its box needs, unless it may show larger", async () => {
  const photo = await noisy(1600, 1200, "image/jpeg");
  const unfitted = await noisy(640, 480, "image/jpeg");
  const { rasterizer } = await frameOf(
    `<body style="margin:0"><img src="${photo}" style="display:block;width:50px;height:40px">` +
      `<img src="${unfitted}" style="display:block;width:50px;height:40px;object-fit:none"></body>`,
  );
  const { svg } = await rasterizer.snapshot();
  const sizes = await Promise.all(
    (svg.match(/data:image\/jpeg;base64,[\w+/=]+/g) ?? []).map(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }),
  );
  // Halved four times: 100 x 75 still covers the 50 x 40 box twice over, 50 x 38 would not.
  expect(sizes).toEqual([
    [100, 75],
    [640, 480],
  ]);
  const [r = 0, , b = 0] = await pixel(rasterizer, 25, 20);
  expect(r).toBeLessThan(100);
  expect(b).toBeGreaterThan(150);
});

it("decodes the image again only once the snapshot changed, reusing the encoding of long resources", async () => {
  const texture = await noisy(160, 120, "image/png");
  const { win, rasterizer } = await frameOf(
    `<body style="margin:0"><div style="width:100px;height:50px;background:url(${texture})"></div><p>a</p></body>`,
  );
  const decode = vi.spyOn(HTMLImageElement.prototype, "decode");
  const encode = vi.spyOn(globalThis, "encodeURIComponent");
  try {
    const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
    await rasterizer.draw(ctx);
    // Nothing changed: the decoded image is drawn again.
    await rasterizer.draw(ctx);
    expect(decode).toHaveBeenCalledTimes(1);
    encode.mockClear();
    (win.document.querySelector("p") as HTMLElement).textContent = "b";
    await rasterizer.draw(ctx);
    expect(decode).toHaveBeenCalledTimes(2);
    // Only the markup around the texture was encoded again.
    expect(Math.max(...encode.mock.calls.map(([text]) => String(text).length))).toBeLessThan(texture.length);
  } finally {
    decode.mockRestore();
    encode.mockRestore();
  }
});

it("walks the frame again only after a mutation, a scroll or an animation seek, or always over canvas pixels", async () => {
  const { win, rasterizer } = await frameOf(
    '<body style="margin:0"><div id=s style="height:100px;overflow:hidden">' +
      '<div style="height:100px;background:rgb(255,0,0)"></div><div style="height:100px;background:rgb(0,0,255)"></div>' +
      "</div></body>",
  );
  const box = win.document.getElementById("s") as HTMLElement;
  const walk = vi.spyOn(rasterizer, "snapshot");
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  const frame = async () => {
    await rasterizer.draw(ctx);
    return [walk.mock.calls.length, Array.from(ctx.getImageData(5, 5, 1, 1).data.slice(0, 3))];
  };
  expect(await frame()).toEqual([1, [255, 0, 0]]);
  // Nothing changed: no walk.
  expect(await frame()).toEqual([1, [255, 0, 0]]);
  // Neither a scroll nor a seek of a paused animation mutates the DOM.
  box.scrollTop = 100;
  expect(await frame()).toEqual([2, [0, 0, 255]]);
  const fade = box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1000, fill: "forwards" });
  fade.pause();
  expect((await frame())[0]).toBe(3);
  fade.currentTime = 1000;
  expect(await frame()).toEqual([4, [255, 255, 255]]);
  fade.cancel();
  // A canvas painted over is drawn into the image: its pixels change unseen, so every frame walks.
  box.innerHTML = '<canvas width=10 height=10></canvas><p style="margin:0;height:10px;background:#fff"></p>';
  expect((await frame())[0]).toBe(5);
  expect((await frame())[0]).toBe(6);
});
