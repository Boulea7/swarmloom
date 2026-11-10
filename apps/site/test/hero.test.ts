import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementModule } from "../src/client/hero";
import { zh } from "../src/content/zh";
import { linksFor } from "../src/render/links";
import { hero } from "../src/render/sections/top";

let tagCount = 0;

/** Registers a fresh tag; `playable` decides whether it looks like the real element or the API stub. */
function fakeModule(playable: boolean): ElementModule {
  const tag = `fake-loom-${++tagCount}`;
  class Fake extends HTMLElement {
    replayed = 0;
    replay(): void {
      this.replayed++;
    }
  }
  if (playable) Object.assign(Fake.prototype, { play() {} });
  return { TAG_NAME: tag, define: () => customElements.define(tag, Fake) };
}

/** Imports the hero module with a given reduced-motion preference (env.ts reads it at load). */
async function loadHero(reduced: boolean) {
  vi.resetModules();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  return import("../src/client/hero");
}

const heroEl = () => document.querySelector<HTMLElement>("[data-hero]") as HTMLElement;
const copyEl = () => document.querySelector<HTMLElement>("[data-hero-copy]") as HTMLElement;
const replayButton = () => document.querySelector<HTMLButtonElement>("[data-replay]") as HTMLButtonElement;

describe("initHero", () => {
  beforeEach(() => {
    document.body.innerHTML = hero(zh, linksFor("zh", "/"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the static hero when the element is the API stub or fails to load", async () => {
    const { initHero } = await loadHero(false);
    await expect(initHero({ load: async () => fakeModule(false) })).resolves.toBe("static");
    await expect(initHero({ load: () => Promise.reject(new Error("offline")) })).resolves.toBe("static");
    expect(copyEl().parentElement?.classList.contains("hero-in")).toBe(true);
    expect(replayButton().hidden).toBe(true);
  });

  it("wraps the copy in the live element and restores it on error", async () => {
    const { initHero } = await loadHero(false);
    const mod = fakeModule(true);
    await expect(initHero({ load: async () => mod, guardMs: 60_000 })).resolves.toBe("pending");
    const live = copyEl().parentElement as HTMLElement;
    expect(live.localName).toBe(mod.TAG_NAME);
    expect(live.getAttribute("reduced-motion")).toBe("auto");
    expect(heroEl().dataset.live).toBe("pending");

    const error = new CustomEvent("swarm-error", { cancelable: true, detail: { error: new Error("boom") } });
    live.dispatchEvent(error);
    expect(error.defaultPrevented).toBe(true);
    expect(live.isConnected).toBe(false);
    expect(copyEl().parentElement?.classList.contains("hero-in")).toBe(true);
    expect(heroEl().dataset.live).toBe("static");
  });

  it("never autoplays under reduced motion and offers a quiet build button", async () => {
    const { initHero } = await loadHero(true);
    const mod = fakeModule(true);
    await expect(initHero({ load: async () => mod, guardMs: 60_000 })).resolves.toBe("static");
    expect(document.querySelector(mod.TAG_NAME as string)).toBeNull();
    const button = replayButton();
    expect(button.hidden).toBe(false);
    expect(button.textContent).toContain(zh.hero.replayReduced);

    button.click();
    const live = document.querySelector(mod.TAG_NAME as string);
    expect(live?.getAttribute("reduced-motion")).toBe("false");
    expect(button.hidden).toBe(true);
  });
});
