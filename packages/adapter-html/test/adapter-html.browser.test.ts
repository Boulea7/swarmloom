import type { Blueprint, CustomLayer, Plugin } from "@swarmloom/core";
import { afterEach, describe, expect, it } from "vitest";
import fadeIn from "../../../examples/html/fade-in.html?raw";
import landing from "../../../examples/html/landing.html?raw";
import { createHtmlAdapter, type HtmlLoadContext, TIMELINE_PLUGIN } from "../src/index";
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
      "The same build, every time",
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
