import { afterEach, expect, it } from "vitest";
import { FrameRasterizer } from "../src/browser/raster/rasterize";

const SIZE = 100;
const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

// Firefox has no CSS Typed OM.
const typedOm = "attributeStyleMap" in HTMLElement.prototype && "styleMap" in CSSStyleRule.prototype;

it.skipIf(!typedOm)(
  "reads an inline style written through the Typed OM box by box, and a rule's as a sheet edit",
  async () => {
    const frame = document.createElement("iframe");
    frame.style.cssText = `border:0;width:${SIZE}px;height:${SIZE}px`;
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    const cards = Array.from({ length: 40 }, (_, i) => `<section style="height:100px"><p>far ${i}</p></section>`);
    frame.srcdoc = `<style>#bar { background: rgb(255, 0, 0) }</style><body style="margin:0">
      <div id=bar style="width:100px;height:50px"></div>${cards.join("")}</body>`;
    document.body.append(frame);
    frames.push(frame);
    await loaded;
    const win = frame.contentWindow as Window;
    await win.document.fonts.ready;
    const rasterizer = new FrameRasterizer({
      document: win.document,
      width: SIZE,
      height: SIZE,
      shadows: { roots: () => [], stop() {} },
      fonts: { faces: () => [], stop() {} },
    });
    const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d") as OffscreenCanvasRenderingContext2D;
    const frameOf = async () => {
      const { reused } = await rasterizer.draw(ctx);
      const at = (x: number) => Array.from(ctx.getImageData(x, 25, 1, 1).data.slice(0, 3));
      return { left: at(25), right: at(75), farReused: reused > 30 };
    };
    expect(await frameOf()).toEqual({ left: [255, 0, 0], right: [255, 0, 0], farReused: false });
    // As `bar.style.width = ...`, a mutation of the bar's style attribute: the far cards stay as written.
    const bar = win.document.getElementById("bar") as HTMLElement;
    bar.attributeStyleMap.set("width", "50px");
    expect(await frameOf()).toEqual({ left: [255, 0, 0], right: [255, 255, 255], farReused: true });
    // The frame after a change walks again after the rendering update and holds from then on, so
    // only the text of the rules tells the edit below.
    expect(await frameOf()).toEqual({ left: [255, 0, 0], right: [255, 255, 255], farReused: true });
    // A rule's map edits the sheet without a mutation: the frame is walked again all the same.
    // WebKit loses the first edit of an inline sheet, whose rules it shares with a cache: the edit
    // clones them, and its rule map writes to the rule it held from before the clone. Write the
    // value the rule has to make the clone, then take the rule again and edit it.
    const sheet = win.document.styleSheets[0] as CSSStyleSheet;
    (sheet.cssRules[0] as CSSStyleRule).styleMap.set("background-color", "rgb(255, 0, 0)");
    (sheet.cssRules[0] as CSSStyleRule).styleMap.set("background-color", "rgb(0, 0, 255)");
    expect(win.getComputedStyle(bar).backgroundColor).toBe("rgb(0, 0, 255)");
    expect((await frameOf()).left).toEqual([0, 0, 255]);
  },
);
