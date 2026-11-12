import { afterEach, expect, it, vi } from "vitest";
import type { WatchedFace } from "../src/browser/raster/fonts";
import { FrameRasterizer } from "../src/browser/raster/rasterize";

const SIZE = 60;
/** Not a usable font (text falls back), but as long as a small one. */
const FONT = `data:font/woff2;base64,${"A".repeat(200_000)}`;
const RULE = `@font-face{font-family:Dup;src:url(${FONT}) format("woff2");font-display:block}`;
const TEXT = '<p style="font-family:Dup">x</p>';
const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

async function frameOf(html: string, faces: WatchedFace[] = []): Promise<{ win: Window; rasterizer: FrameRasterizer }> {
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
    fonts: { faces: () => faces, stop() {} },
  });
  return { win, rasterizer };
}

it("embeds a face declared in the page, again in another sheet and through FontFace once", async () => {
  const { rasterizer } = await frameOf(`<style>${RULE}</style><style>${RULE}</style>${TEXT}`, [
    { family: "Dup", source: `url(${FONT})`, descriptors: { display: "block" } },
  ]);
  const { svg } = await rasterizer.snapshot();
  expect(svg.match(/@font-face/g)).toHaveLength(1);
});

it("reads and encodes the font faces once for all frames", async () => {
  const { win, rasterizer } = await frameOf(`<style>${RULE}</style>${TEXT}`);
  const proto = (win as Window & typeof globalThis).CSSRule.prototype;
  const cssText = Object.getOwnPropertyDescriptor(proto, "cssText")?.get as () => string;
  let reads = 0;
  Object.defineProperty(proto, "cssText", {
    configurable: true,
    get(this: CSSRule) {
      if (this.type === 5) reads++;
      return cssText.call(this);
    },
  });
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
  await rasterizer.draw(ctx);
  const encode = vi.spyOn(globalThis, "encodeURIComponent");
  await rasterizer.draw(ctx);
  const encoded = encode.mock.calls.reduce((sum, [text]) => sum + String(text).length, 0);
  encode.mockRestore();
  expect({ reads, encodedTheFont: encoded > FONT.length }).toEqual({ reads: 1, encodedTheFont: false });
});

it.each<[string, (sheet: CSSStyleSheet) => void]>([
  ["into a grouping rule", (sheet) => (sheet.cssRules[1] as CSSMediaRule).insertRule(RULE, 0)],
  [
    "in place of a rule",
    (sheet) => {
      sheet.deleteRule(0);
      sheet.insertRule(`@media all{${RULE}}`, 0);
    },
  ],
])("walks the style sheets again only once a face is added %s", async (_name, change) => {
  const { win, rasterizer } = await frameOf(`<style>.a{color:red}@media all{.b{color:blue}}</style>${TEXT}`);
  const proto = (win as Window & typeof globalThis).CSSRule.prototype;
  const type = Object.getOwnPropertyDescriptor(proto, "type")?.get as () => number;
  let reads = 0;
  Object.defineProperty(proto, "type", {
    configurable: true,
    get(this: CSSRule) {
      reads++;
      return type.call(this);
    },
  });
  await rasterizer.snapshot();
  reads = 0;
  await rasterizer.snapshot();
  const unchanged = reads;
  change(win.document.styleSheets[0] as CSSStyleSheet);
  const { svg } = await rasterizer.snapshot();
  expect({ unchanged, embedded: svg.includes("@font-face") }).toEqual({ unchanged: 0, embedded: true });
});
