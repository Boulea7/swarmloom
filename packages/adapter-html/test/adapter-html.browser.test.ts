import type { Blueprint, CustomLayer, Plugin } from "@swarmloom/core";
import { afterEach, describe, expect, it } from "vitest";
import fadeIn from "../../../examples/html/fade-in.html?raw";
import landing from "../../../examples/html/landing.html?raw";
import { FREEZE_PASSES } from "../src/frame";
import { createHtmlAdapter, freezeAnimations, type HtmlLoadContext, TIMELINE_PLUGIN } from "../src/index";
import { probeSnapshot } from "./probe";

const ctx = { document, width: 1280, theme: "light" as const };
const adapter = createHtmlAdapter({ snapshot: probeSnapshot });

function byRole(bp: Blueprint, role: string) {
  return bp.layers.filter((l) => l.role === role);
}

function externalRequests(since: number): string[] {
  return performance
    .getEntriesByType("resource")
    .filter((e) => e.startTime >= since && new URL(e.name).origin !== location.origin)
    .map((e) => e.name);
}

afterEach(() => {
  // Capture frames never outlive load() unless keepLive asked for them.
  expect(document.querySelectorAll("iframe[title='SwarmLoom capture frame']")).toHaveLength(0);
});

describe("html examples in Chromium", () => {
  it("landing.html lays out in the sandbox frame with its sections, headings and buttons", async () => {
    const t0 = performance.now();
    const { blueprint, warnings } = await adapter.load({ name: "landing.html", text: landing }, ctx);
    expect(warnings).toEqual([]);
    expect(blueprint.source).toMatchObject({
      type: "html",
      name: "landing.html",
      title: "SwarmLoom: watch a swarm of cursors weave it into being",
    });
    expect(blueprint.size.w).toBe(1280);
    expect(blueprint.size.h).toBeGreaterThan(800);
    expect(blueprint.icon).toMatch(/^data:image\/svg\+xml,/);

    expect(byRole(blueprint, "heading").map((l) => ("text" in l ? l.text : ""))).toEqual([
      "Watch a swarm of cursors weave it into being.",
      "Many formats, one stage",
      "Repeatable builds",
      "Sound that follows the hands",
      "How it works",
    ]);
    expect(byRole(blueprint, "button")).toHaveLength(3);
    expect(byRole(blueprint, "list-item")).toHaveLength(3);
    expect(byRole(blueprint, "nav")).toHaveLength(1);
    // The feature cards rise in with a staggered entrance; all of them are captured visible.
    const cards = byRole(blueprint, "section").filter((l) => l.box.h > 100 && l.box.w < 400);
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(card.opacity).toBe(1);
    // Desktop layout: hero text and canvas side by side.
    const hero = byRole(blueprint, "heading")[0];
    expect(hero?.box.x).toBeLessThan(200);
    expect(hero?.box.w).toBeLessThan(640);
    expect(externalRequests(t0)).toEqual([]);
  });

  it("fade-in.html: entrances captured at their end state, loops at half a cycle (C02)", async () => {
    const { blueprint } = await adapter.load({ name: "fade-in.html", text: fadeIn }, ctx);
    const opacity = Object.fromEntries(blueprint.layers.map((l) => [l.id, l.opacity]));
    expect(opacity.headline).toBe(1);
    expect(opacity.lead).toBe(1);
    // blink runs 0 -> 1 -> 0 over 2 s; half a cycle in it is fully visible.
    expect(opacity.badge).toBe(1);
    const headline = blueprint.layers.find((l) => l.id === "headline");
    expect(headline?.box.y).toBe(64);
  });

  it("keepLive hands back the frame; resume() lets the frozen loops play again", async () => {
    const live = createHtmlAdapter({ snapshot: probeSnapshot, keepLive: true });
    const loaded = await live.load({ name: "fade-in.html", text: fadeIn }, ctx);
    try {
      const doc = loaded.live?.document;
      expect(doc?.querySelector("#badge")).not.toBeNull();
      const loops = doc?.getAnimations().filter((a) => a.playState === "paused") ?? [];
      expect(loops).toHaveLength(1);
      loaded.live?.resume();
      expect(loops[0]?.playState).toBe("running");
    } finally {
      loaded.dispose?.();
    }
  });

  it("also freezes the transitions and animations its own poses set off", async () => {
    // Half a cycle in, the box is 300 px wide and the container query starts a 60 s transition and a loop.
    const page =
      "<!DOCTYPE html><html><head><style>" +
      "@keyframes grow{from{width:100px}to{width:500px}}@keyframes spin{to{transform:rotate(360deg)}}" +
      ".box{container-type:inline-size;animation:grow 10s linear infinite}" +
      "#bar{height:20px;width:0;transition:width 60s linear}#dot{width:20px;height:20px}" +
      "@container (min-width:250px){#bar{width:100%}#dot{animation:spin 3s linear infinite}}" +
      "</style></head><body><div class='box'><section id='bar'></section><section id='dot'></section></div></body></html>";
    const live = createHtmlAdapter({ snapshot: probeSnapshot, keepLive: true });
    const loaded = await live.load({ text: page }, ctx);
    try {
      expect(loaded.blueprint.layers.find((l) => l.id === "bar")?.box.w).toBe(300);
      // Nothing is left running on wall time until go live.
      const doc = loaded.live?.document;
      expect(doc?.getAnimations().map((a) => [a.playState, a.currentTime])).toEqual([
        ["paused", 5000],
        ["paused", 1500],
      ]);
    } finally {
      loaded.dispose?.();
    }
  });

  it("follows a chain of set-off animations to its end, and warns when it outruns the passes", async () => {
    // Half a cycle in, each box is 300 px wide and the container query starts the loop of the box inside.
    const nested = (depth: number) =>
      "<!DOCTYPE html><html><head><style>@keyframes grow{from{width:100px}to{width:500px}}" +
      ".box{container-type:inline-size;width:100px;height:2px}#b0{animation:grow 10s linear infinite}" +
      "@container (min-width:250px){.box>.box{animation:grow 10s linear infinite}}</style></head><body>" +
      `<div id='b0' class='box'>${"<div class='box'>".repeat(depth - 1)}${"</div>".repeat(depth)}</body></html>`;
    const live = createHtmlAdapter({ snapshot: probeSnapshot, keepLive: true });
    const results: [number, boolean][] = [];
    // A chain exactly as long as the passes is frozen whole, so it must not warn.
    for (const depth of [9, FREEZE_PASSES, FREEZE_PASSES + 3]) {
      const loaded = await live.load({ text: nested(depth) }, ctx);
      try {
        const paused = loaded.live?.document.getAnimations().filter((a) => a.playState === "paused") ?? [];
        results.push([paused.length, loaded.warnings.some((w) => w.includes("kept starting"))]);
      } finally {
        loaded.dispose?.();
      }
    }
    expect(results).toEqual([
      [9, false],
      [FREEZE_PASSES, false],
      [FREEZE_PASSES, true],
    ]);
  });

  it("freezes the animations in content-visibility:auto sections, which the off-screen frame skips", async () => {
    const page =
      "<!DOCTYPE html><html><head><style>" +
      "section{content-visibility:auto;contain-intrinsic-size:auto 200px;height:200px}" +
      "@keyframes rise{from{opacity:0}}@keyframes spin{to{transform:translateX(200px)}}" +
      "p{animation:rise 2.5s ease-out}#dot{width:20px;height:20px;animation:spin 1.3s linear infinite}" +
      "</style></head><body><section><p id='lead'>Hello</p><div id='dot'></div></section>" +
      "<section><p id='more'>More</p></section></body></html>";
    const live = createHtmlAdapter({ snapshot: probeSnapshot, keepLive: true });
    const loaded = await live.load({ text: page }, ctx);
    try {
      const opacity = Object.fromEntries(loaded.blueprint.layers.map((l) => [l.id, l.opacity]));
      expect([opacity.lead, opacity.more]).toEqual([1, 1]);
      const doc = loaded.live?.document;
      expect(doc?.getAnimations().map((a) => [a.playState, a.currentTime])).toEqual([["paused", 650]]);
      // The sections get their own value back for the live page.
      expect(doc?.querySelector("section")?.hasAttribute("style")).toBe(false);
    } finally {
      loaded.dispose?.();
    }
  });

  it("shows content-visibility:auto elements with one restyle per nesting level, not one per element", async () => {
    // Each style read after a write restyles the frame: one per section took seconds on long pages.
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;left:-20000px;top:0;width:800px;height:600px;border:0";
    frame.srcdoc =
      "<!DOCTYPE html><style>section,.in{content-visibility:auto}.in{display:inline-block}" +
      "@keyframes rise{from{opacity:0}}b{animation:rise 1s}i{display:block;animation:rise 1s infinite}</style>" +
      "<section><p>Text <span class='in'><b>in</b></span></p><i></i></section>".repeat(40);
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    document.body.append(frame);
    try {
      await loaded;
      const win = frame.contentWindow as Window & typeof globalThis;
      let wrote = false;
      let restyles = 0;
      const read = win.getComputedStyle.bind(win);
      win.getComputedStyle = (el, pseudo) => {
        if (wrote) restyles++;
        wrote = false;
        return read(el, pseudo);
      };
      const write = win.CSSStyleDeclaration.prototype.setProperty;
      win.CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, ...args) {
        wrote = true;
        return write.apply(this, args);
      };
      const frozen = freezeAnimations(win.document);
      // The nested spans and their bold text count: section, then span, then b.
      expect([frozen.finished, frozen.paused, restyles]).toEqual([40, 40, 2]);
    } finally {
      frame.remove();
    }
  });

  it("reads the animations again only where the page's rules let a pose start one", async () => {
    // Each read sorts every animation of the page: entrances on thousands of cards took a third longer.
    const cases: [css: string, html: string, counts: number[]][] = [
      // Fades and slides start nothing, whatever transitions the page declares.
      [
        "@keyframes rise{from{opacity:0;transform:translateY(9px)}}p{animation:rise 1s;transition:color 1s}",
        "<p>a</p><p>b</p>",
        [1, 2, 0],
      ],
      // A finished transition changes its own property: the box's full width starts the dot's glow.
      [
        "@keyframes glow{to{opacity:.5}}.box{container-type:inline-size;width:500px;transition:width 60s linear}" +
          "@starting-style{.box{width:100px}}@container (min-width:250px){#dot{animation:glow 2s infinite}}",
        "<div class='box'><i id='dot'></i></div>",
        [3, 1, 1],
      ],
    ];
    const results: number[][] = [];
    for (const [css, html] of cases) {
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;left:-20000px;top:0;width:800px;height:600px;border:0";
      frame.srcdoc = `<!DOCTYPE html><style>${css}</style>${html}`;
      const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
      document.body.append(frame);
      try {
        await loaded;
        const doc = frame.contentDocument as Document;
        const read = doc.getAnimations.bind(doc);
        let reads = 0;
        doc.getAnimations = () => {
          reads++;
          return read();
        };
        const frozen = freezeAnimations(doc);
        results.push([reads, frozen.finished, frozen.paused]);
      } finally {
        frame.remove();
      }
    }
    expect(results).toEqual(cases.map(([, , counts]) => counts));
  });

  it("adds keyframe timelines under animated elements only when the host registers anim:timeline", async () => {
    const timeline: Plugin = {
      name: TIMELINE_PLUGIN,
      tasks: {
        [TIMELINE_PLUGIN]: function* () {
          yield 0;
        },
      },
    };
    const plain = await adapter.load({ name: "fade-in.html", text: fadeIn }, ctx);
    expect(plain.plugins).toBeUndefined();
    const registered: HtmlLoadContext = { ...ctx, plugins: [timeline] };
    const { blueprint, plugins } = await adapter.load({ name: "fade-in.html", text: fadeIn }, registered);
    const bars = blueprint.layers.filter((l): l is CustomLayer => l.kind === "custom" && l.task === TIMELINE_PLUGIN);
    // The data has the shape the Lottie zone's plugin reads; rest is the captured pose.
    const timings = [
      { duration: 900, keyframes: [0, 900], rest: 900 },
      { duration: 1300, keyframes: [400, 1300], rest: 1300 },
      { duration: 2000, keyframes: [0, 1000, 2000], rest: 1000 },
    ];
    expect(bars.map((l) => l.data)).toEqual(timings);
    for (const bar of bars) {
      // A bar sits in free space under or above its element: nothing else on the page is under it.
      const b = bar.box;
      const under = blueprint.layers.filter(
        (l) =>
          l !== bar && l.box.x < b.x + b.w && b.x < l.box.x + l.box.w && l.box.y < b.y + b.h && b.y < l.box.y + l.box.h,
      );
      expect(under.map((l) => l.id)).toEqual([]);
    }
    expect(blueprint.plugins).toEqual([TIMELINE_PLUGIN]);
    expect(plugins).toEqual([timeline]);
    const bad = { ...ctx, plugins: { [TIMELINE_PLUGIN]: timeline } } as unknown as HtmlLoadContext;
    await expect(adapter.load({ text: fadeIn }, bad)).rejects.toThrow(/ctx.plugins must be an array/);
  });

  it("never runs scripts or loads remote style sheets, and says so", async () => {
    const t0 = performance.now();
    const page =
      '<!DOCTYPE html><html><head><link rel="stylesheet" href="https://cdn.example.invalid/x.css">' +
      '<script>parent.document.title = "owned"</script></head>' +
      '<body><h1 id="t">Static</h1><img src="x" onerror="parent.document.title = \'owned\'"></body></html>';
    const before = document.title;
    const { blueprint, warnings } = await adapter.load({ text: page }, ctx);
    expect(document.title).toBe(before);
    expect(blueprint.layers.find((l) => l.id === "t")).toBeDefined();
    expect(warnings[0]).toMatch(/has scripts; it is shown as written/);
    expect(externalRequests(t0)).toEqual([]);
  });
});
