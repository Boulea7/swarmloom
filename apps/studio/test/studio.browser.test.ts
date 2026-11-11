import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../src/styles/studio.css";
import { mountStudio, type StudioApp } from "../src/app";
import {
  type ExampleEntry,
  type ExampleManifest,
  entriesForLocale,
  isHousekeeping,
  planExamples,
  sortEntries,
} from "../src/examples/manifest";
import { fakeServices } from "./fakes";

/** Every file of the repository's examples folder, as the build would see it (paths only). */
const FILES = Object.keys(import.meta.glob("../../../examples/**/*"))
  .map((p) => p.replace(/^(\.\.\/)+examples\//, ""))
  .filter((p) => !isHousekeeping(p))
  .sort();

const MANIFEST: ExampleManifest = {
  version: 1,
  entries: sortEntries(
    planExamples(FILES).map(
      (c): ExampleEntry => ({ id: c.id, path: c.path, format: c.format, title: c.path, size: 1024, group: c.group }),
    ),
  ),
};

const EXAMPLES_BASE = new URL("/examples/", location.origin).href;

let app: StudioApp | null = null;

async function mount(search = "", seekable = false) {
  history.replaceState(null, "", `${location.pathname}${search}`);
  const root = document.createElement("div");
  document.body.append(root);
  const fake = fakeServices({ manifest: MANIFEST, examplesBase: EXAMPLES_BASE, seekable });
  app = await mountStudio(root, fake.services);
  return { root, ...fake };
}

async function until<T>(probe: () => T | null | undefined, timeoutMs = 4000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (performance.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.replaceChildren();
  history.replaceState(null, "", location.pathname);
});

describe("Studio in a browser", () => {
  it("renders home with the open actions and one card per repository example", async () => {
    const { root } = await mount();
    expect(document.documentElement.dataset.view).toBe("home");
    expect(root.querySelector("h1")?.textContent).not.toBe("");
    expect(root.querySelector(".dropzone")).not.toBeNull();
    expect(root.querySelector(".url-form input")).not.toBeNull();

    expect(MANIFEST.entries.length).toBeGreaterThanOrEqual(4);
    const ids = [...root.querySelectorAll<HTMLAnchorElement>(".card")].map((card) => card.dataset.example);
    // One card per example group: language and file-type variants share a card.
    expect(ids).toEqual(entriesForLocale(MANIFEST, "en").map((e) => e.id));
  });

  it("opens an example into the inline stage", async () => {
    const { root, log } = await mount();
    const card = root.querySelector<HTMLAnchorElement>('.card[data-example="svg-chart"]');
    expect(card).not.toBeNull();
    card?.click();

    const stage = await until(() => root.querySelector<HTMLElement>(".stage-host [data-fake-stage]"));
    expect(document.documentElement.dataset.view).toBe("player");
    expect(new URL(location.href).searchParams.get("example")).toBe("svg-chart");
    expect(stage.dataset.fakeStage).toBe("svg");
    expect(log.loads[0]?.name).toBe("chart.svg");
    expect(log.loads[0]?.text).toContain("<svg");
    expect(log.contexts[0]?.network).toBe("https");
    expect(log.players[0]).toMatchObject({ mode: "inline", host: root.querySelector(".stage-host") });

    root.querySelector<HTMLButtonElement>(".play-big")?.click();
    expect(log.calls).toContain("play");
  });

  it("seeks once per frame to the latest value while the scrubber is dragged", async () => {
    const { root, log } = await mount("?example=svg-chart", true);
    (await until(() => root.querySelector<HTMLButtonElement>(".play-big"))).click();
    const seeker = root.querySelector<HTMLInputElement>(".scrub-range");
    expect(seeker?.hidden).toBe(false);
    for (const value of ["100", "200", "300"]) {
      if (!seeker) break;
      seeker.value = value;
      seeker.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const seeks = () => log.calls.filter((c) => c.startsWith("seek:"));
    expect(seeks()).toEqual([]);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(seeks()).toEqual(["seek:3600"]); // 300 / 1000 of the fake's 12 s plan
  });

  it("explains an unknown example instead of mounting a player", async () => {
    const { root, log } = await mount("?example=missing");
    await until(() => root.querySelector(".stage-error"));
    expect(log.players).toHaveLength(0);
  });

  it("applies the Motion setting to Studio's own animations, not only the player", async () => {
    const { root } = await mount();
    const cursor = await until(() => root.querySelector<HTMLElement>(".decor-cursor"));
    const iterations = () => getComputedStyle(cursor).animationIterationCount;
    app?.context.updateSettings({ reducedMotion: "reduce" });
    expect(iterations()).toBe("1");
    // "full" overrides a system reduce preference, matching what the player gets.
    app?.context.updateSettings({ reducedMotion: "full" });
    expect(iterations()).toBe("infinite");
  });

  it("keeps the drop zone's cursors clear of a long German title on a 320px phone", async () => {
    await page.viewport(320, 568);
    try {
      const { root } = await mount("?lang=de");
      const inner = await until(() => root.querySelector<HTMLElement>(".dropzone-inner"));
      const content = inner.getBoundingClientRect();
      const cursors = [...root.querySelectorAll<HTMLElement>(".dropzone .decor-cursor")].filter(
        (el) => el.getClientRects().length > 0,
      );
      expect(cursors.length).toBeGreaterThan(0);
      const drift = 10; // the most the drift keyframes move a cursor, in px
      for (const cursor of cursors) {
        cursor.style.animation = "none";
        const r = cursor.getBoundingClientRect();
        const clear =
          r.bottom + drift <= content.top ||
          r.top - drift >= content.bottom ||
          r.right + drift <= content.left ||
          r.left - drift >= content.right;
        expect(clear, cursor.textContent ?? "").toBe(true);
      }
    } finally {
      await page.viewport(414, 896);
    }
  });
});
