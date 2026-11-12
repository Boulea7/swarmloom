import { createPlayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { base64ToBytes, bytesToBase64, canRecordElement, createRenderApi, recordElement } from "../src/index";
import { LiveStage, watchShadowRoots } from "../src/render/live";

// These cases also run in Firefox; Region Capture and classic scrollbars are Chromium's.
const chromium = server.browser === "chromium";

/** The top-left pixel (RGBA) the image at `url` paints, or a rejection when it does not decode. */
async function firstPixel(url: string | null | undefined): Promise<number[]> {
  const img = new Image();
  img.src = url ?? "";
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0);
  return Array.from(ctx.getImageData(0, 0, 1, 1).data);
}

describe("export in the browser", () => {
  it.runIf(chromium)("detects live recording support", async () => {
    // Chromium ships getDisplayMedia, Region/Element Capture and MediaRecorder with WebM.
    expect(canRecordElement()).toBe(true);
    await expect(recordElement(document.createElement("div"))).rejects.toThrow("in the document");
  });

  it("round-trips multi-megabyte payloads through base64", () => {
    const bytes = new Uint8Array(3 << 20).map((_, i) => (i * 31) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("gives the stage the whole frame width, with its scrollbar gutter past the right edge", async () => {
    const blueprint = {
      version: 1 as const,
      source: { type: "fake" },
      size: { w: 320, h: 400 },
      background: "#fff",
      layers: [],
    };
    const api = createRenderApi({
      load: async () => ({ blueprint }),
      createPlayer,
      renderAudioWav: async () => new Uint8Array(),
    });
    // The stage's shadow roots are closed: record them as they are attached.
    const shadows = watchShadowRoots(window);
    try {
      await api.init({ input: { name: "a.md", text: "# Hi" }, width: 320, height: 200, fps: 25, sound: false });
      const scroller = shadows
        .roots()
        .map((root) => root.querySelector<HTMLElement>(".scroller"))
        .find((el) => el !== null);
      if (!scroller) throw new Error("No stage scroller in the render host");
      // The real inline scroller reserves its gutter, and the host is widened by exactly that much.
      // Headless Firefox draws overlay scrollbars, which take no gutter.
      if (chromium) expect(scroller.offsetWidth).toBeGreaterThan(scroller.clientWidth);
      expect(scroller.clientWidth).toBe(320);
    } finally {
      api.dispose();
      shadows.stop();
    }
  });

  it("holds a <marquee> on the live page at its resting pose instead of scrolling on wall time", async () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = "position:fixed;left:-2000px;top:0;width:320px;height:200px;border:0";
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.srcdoc = '<body style="margin:0"><marquee scrollamount="12" style="width:300px">Ticker</marquee>';
    // The stage world is the host of a shadow root that sits in another one, as tall as the page.
    const host = document.createElement("div");
    const outer = host.attachShadow({ mode: "open" });
    const world = document.createElement("div");
    world.style.height = "200px";
    outer.append(world);
    const roots = [outer, world.attachShadow({ mode: "open" })];
    document.body.append(host, frame);
    try {
      await loaded;
      const doc = frame.contentDocument as Document;
      const textOffset = () => {
        const marquee = doc.querySelector("marquee") as HTMLElement;
        const range = doc.createRange();
        range.selectNodeContents(marquee);
        return range.getBoundingClientRect().left - marquee.getBoundingClientRect().left;
      };
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(textOffset()).toBeGreaterThan(0); // scrolling in from the right
      const stage = new LiveStage({
        document,
        host,
        shadows: { roots: () => roots, stop() {} },
        page: { frame, document: doc },
      });
      stage.goLive(0);
      const atLive = textOffset();
      await new Promise((resolve) => setTimeout(resolve, 150));
      stage.sync(150);
      expect([atLive, textOffset()]).toEqual([0, 0]);
    } finally {
      frame.remove();
      host.remove();
    }
  });

  it("shows an animated GIF on the live page as its first frame: an <img> at the same size, a background, an SVG <image>, a video poster, an image button", async () => {
    // 1x1 GIF, red then blue, looping.
    const gif =
      "data:image/gif;base64,R0lGODlhAQABAIABAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAAAICTAEAOw==";
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = "position:fixed;left:-2000px;top:0;width:320px;height:200px;border:0";
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.srcdoc = `<style>i{display:block;height:4px;background:url(${gif})}</style><body style="margin:0"><img src="${gif}"><i></i><svg width="4" height="4"><image href="${gif}" width="4" height="4"/></svg><video poster="${gif}"></video><input type="image" src="${gif}">`;
    document.body.append(frame);
    try {
      await loaded;
      const doc = frame.contentDocument as Document;
      const stage = new LiveStage({
        document,
        host: document.body,
        shadows: { roots: () => [], stop() {} },
        page: { frame, document: doc },
      });
      await stage.holdImages();
      const img = doc.querySelector("img") as HTMLImageElement;
      expect([img.src.slice(0, 15), img.complete, img.width]).toEqual(["data:image/png;", true, 1]);
      // A stylesheet background is overridden inline, as the stylesheet cannot be rewritten in place.
      const bg = (doc.querySelector("i") as HTMLElement).style;
      expect([bg.backgroundImage.slice(0, 20), bg.getPropertyPriority("background-image")]).toEqual([
        'url("data:image/png;',
        "important",
      ]);
      expect(doc.querySelector("svg image")?.getAttribute("href")?.slice(0, 15)).toBe("data:image/png;");
      // Neither is in document.images.
      const poster = doc.querySelector("video")?.getAttribute("poster");
      const button = doc.querySelector("input")?.getAttribute("src");
      expect([poster?.slice(0, 15), button?.slice(0, 15)]).toEqual(["data:image/png;", "data:image/png;"]);
      // Every still copy shows the first (red) frame, not a blank or the second (blue) frame.
      const bgUrl = /^url\("(.*)"\)$/.exec(bg.backgroundImage)?.[1];
      const svgHref = doc.querySelector("svg image")?.getAttribute("href");
      const stills = [img.src, bgUrl, svgHref, poster, button];
      expect(await Promise.all(stills.map(firstPixel))).toEqual(stills.map(() => [255, 0, 0, 255]));
    } finally {
      frame.remove();
    }
  });

  it("lines the live page up with a scrolled stage at once, despite a page-level smooth scroll", async () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = "position:fixed;left:-2000px;top:0;width:320px;height:200px;border:0";
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.srcdoc = '<style>html{scroll-behavior:smooth}</style><body style="margin:0"><div style="height:400px"></div>';
    // The stage view shows the world scrolled down by 100 px.
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:320px;height:200px;overflow:hidden";
    const outer = host.attachShadow({ mode: "open" });
    const world = document.createElement("div");
    world.style.cssText = "position:relative;top:-100px;height:400px";
    outer.append(world);
    const roots = [outer, world.attachShadow({ mode: "open" })];
    document.body.append(host, frame);
    try {
      await loaded;
      const stage = new LiveStage({
        document,
        host,
        shadows: { roots: () => roots, stop() {} },
        page: { frame, document: frame.contentDocument as Document },
      });
      stage.goLive(0);
      expect([frame.contentWindow?.scrollY, frame.style.top]).toEqual([100, "0px"]);
    } finally {
      frame.remove();
      host.remove();
    }
  });
});
