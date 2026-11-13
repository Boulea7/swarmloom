import { createPlayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { SheetMark, watchSheetEdits } from "../src/browser/raster/sheet-edits";
import { base64ToBytes, bytesToBase64, canRecordElement, createRenderApi, recordElement } from "../src/index";
import { LiveStage, watchShadowRoots } from "../src/render/live";
import { mayStartAnimations, readStyleFacts } from "../src/render/starts";

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

  it("starts a transition a seek sets off at the frame time, however long the frame took", async () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = "position:fixed;left:-2000px;top:0;width:320px;height:200px;border:0";
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    // The box widens with transport time; from 200 px on, a container query turns the chip blue over 1 s.
    frame.srcdoc =
      "<style>@keyframes wide{from{width:100px}to{width:300px}}" +
      ".box{container-type:inline-size;animation:wide 1s linear paused;height:20px}" +
      ".chip{height:10px;background:rgb(255,0,0);transition:background-color 1s linear}" +
      "@container (min-width:200px){.chip{background:rgb(0,0,255)}}</style>" +
      '<body style="margin:0"><div class="box"><div class="chip"></div></div>';
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
      const stage = new LiveStage({
        document,
        host,
        shadows: { roots: () => roots, stop() {} },
        page: { frame, document: doc },
      });
      stage.goLive(0);
      stage.sync(600); // 220 px wide: the chip's transition starts at 600 ms
      await new Promise((resolve) => setTimeout(resolve, 300)); // a slow screenshot
      stage.sync(850);
      const transitions = doc.getAnimations().filter((anim) => "transitionProperty" in anim);
      expect(transitions.map((anim) => anim.currentTime)).toEqual([250]);
    } finally {
      frame.remove();
      host.remove();
    }
  });

  it("freezes live-page animations started after the capture by the capture's rule on go live, however long they ran", async () => {
    // The capture froze the page; these started since (as in a content-visibility section laid out later).
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = "position:fixed;left:-2000px;top:0;width:320px;height:200px;border:0";
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.srcdoc =
      "<style>@keyframes slide{to{transform:translateX(200px)}}@keyframes rise{from{opacity:0}}" +
      ".dot{animation:slide 1.3s linear infinite}.rise{animation:rise 1.5s}</style>" +
      '<body style="margin:0;height:200px"><div class="dot">a</div><div class="rise">b</div>';
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
      const [slide, rise] = doc.getAnimations();
      await new Promise((resolve) => setTimeout(resolve, 200)); // a slow build
      const stage = new LiveStage({
        document,
        host,
        shadows: { roots: () => roots, stop() {} },
        page: { frame, document: doc },
      });
      stage.goLive(3000);
      // The loop at half a cycle (LIVE_LOOP_PHASE), the entrance at its end, then on with transport time.
      expect([slide?.currentTime, rise?.currentTime]).toEqual([650, 1500]);
      stage.sync(3400);
      expect(slide?.currentTime).toBe(1050);
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

  it("paints the canvas colour under a live page without a background, so the stage's copy never shows through", async () => {
    // A frame's canvas is transparent where a tab paints it: the frozen copy under it would show twice.
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = "position:fixed;left:-2000px;top:0;width:320px;height:200px;border:0";
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.srcdoc = '<body style="margin:0;height:200px"><p style="margin:0">Plain';
    const host = document.createElement("div");
    const outer = host.attachShadow({ mode: "open" });
    const world = document.createElement("div");
    world.style.height = "200px";
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
        onWarning: (message) => {
          throw new Error(message);
        },
      });
      stage.goLive(0);
      expect(getComputedStyle(frame).backgroundColor).toBe("rgb(255, 255, 255)");
    } finally {
      frame.remove();
      host.remove();
    }
  });

  it("reads the live page's animations once a frame when no seek can start one there", async () => {
    // Reading them again is what a frame of thousands of CSS animations spends most on. A pulse of
    // opacity reaches no transition or container, whatever the page declares. Telling that from the
    // page's rules must take no declaration through `style` either: the in-browser exporter's still
    // check would compare the text of each one taken on every frame after.
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = "position:fixed;left:-2000px;top:0;width:320px;height:200px;border:0";
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.srcdoc =
      "<style>@keyframes pulse{50%{opacity:.4}}span{animation:pulse 1.5s infinite}" +
      "a{transition:color .2s;border-radius:inherit}.c{container-type:inline-size}</style>" +
      '<body style="margin:0;height:200px"><span>a</span><span>b</span>';
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
      watchSheetEdits(frame.contentWindow, [doc]);
      const sheets = new SheetMark(Array.from(doc.styleSheets));
      const stage = new LiveStage({
        document,
        host,
        shadows: { roots: () => roots, stop() {} },
        page: { frame, document: doc },
      });
      stage.goLive(0);
      expect(sheets.holds()).toBe(true);
      let reads = 0;
      const read = doc.getAnimations.bind(doc);
      doc.getAnimations = () => {
        reads++;
        return read();
      };
      stage.sync(100);
      stage.sync(200);
      expect(reads).toBe(2);
      expect(read().map((anim) => anim.playState)).toEqual(["paused", "paused"]);
    } finally {
      frame.remove();
      host.remove();
    }
  });

  it("tells which styles let a seek start a transition or an animation", () => {
    const glow = "@keyframes glow{to{color:red}}"; // an inherited value
    const cases: [css: string, html: string, starts: boolean][] = [
      ["@keyframes pulse{50%{opacity:.4}}a{transition:color .2s}a:hover{transition:all 1s}", "", false],
      [`${glow}`, "", false],
      [`${glow}.a{transition-duration:0s,0ms;transition-delay:-1s}`, "", false],
      [`${glow}.a{transition:opacity .3s}`, "", true],
      [`${glow}@media screen{.a{transition-delay:1s}}`, "", true],
      [`${glow}.a{color:red;&:hover{transition-duration:1s}}`, "", true],
      [`${glow}.a{&:hover{color:red}transition:color 1s}`, "", true],
      [`${glow}.a{transition:opacity var(--t)}`, "", true],
      [glow, '<p style="transition:color 1s"></p>', true],
      ["@keyframes round{to{border-top-left-radius:9px}}.a{border-radius:inherit;transition:all 1s}", "", true],
      ["@keyframes slide{to{transform:translateX(9px)}}.a{transition:color .2s}", "", false],
      ["@keyframes slide{to{transform:translateX(9px)}}@container (width>9px){.a{color:red}}", "", true],
      ["@keyframes wide{to{width:300px}}.box{container-type:inline-size}", "", true],
      ["@keyframes hue{to{--hue:120}}", "", true],
    ];
    const facts = (css: string, html: string) => {
      const root = document.createElement("div").attachShadow({ mode: "open" });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
      root.innerHTML = html;
      return readStyleFacts(root);
    };
    const results = cases.map(([css, html]) => mayStartAnimations([facts(css, html)]));
    expect(results).toEqual(cases.map(([, , starts]) => starts));
    // A value inherits across a shadow boundary: keyframes in one root reach a transition in another.
    expect(mayStartAnimations([facts(glow, ""), facts(".a{transition:color 1s}", "")])).toBe(true);
  });
});
