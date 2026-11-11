import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import pagesCss from "../public/pages.css?raw";
import welcomeHtml from "../public/welcome.html?raw";
import { DEFAULT_PREFS, savePrefs } from "../src/shared/prefs";
import { createFake } from "./fake-api";

const scope = globalThis as unknown as Record<string, unknown>;
const shadowRoots: ShadowRoot[] = [];
const attachShadow = Element.prototype.attachShadow;
let mounted: HTMLElement[] = [];

/** The player's toolbar dock; the stage keeps it in a closed shadow root, so roots are recorded. */
function toolbarDock(): HTMLElement | null {
  for (const root of shadowRoots) {
    const dock = root.querySelector<HTMLElement>(".dock");
    if (dock) return dock;
  }
  return null;
}

beforeAll(async () => {
  await page.viewport(390, 844);
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const root = attachShadow.call(this, init);
    shadowRoots.push(root);
    return root;
  };
  const fake = createFake();
  await savePrefs(fake.api, { ...DEFAULT_PREFS, reducedMotion: "on" }, 1);
  scope.browser = fake.api;

  const style = document.createElement("style");
  style.textContent = pagesCss;
  const body = new DOMParser().parseFromString(welcomeHtml, "text/html").body;
  const main = document.adoptNode(body.querySelector("main") as HTMLElement);
  document.head.append(style);
  document.body.append(main);
  mounted = [style, main];
  await import("../src/pages/welcome");
});

afterAll(() => {
  Element.prototype.attachShadow = attachShadow;
  for (const el of mounted) el.remove();
  delete scope.browser;
});

describe("welcome page", () => {
  it("plays the demo with the stored reduced-motion setting", async () => {
    await vi.waitFor(() => expect(document.querySelector("swarm-loom")?.getAttribute("reduced-motion")).toBe("true"));
  });

  it("keeps the finished demo's toolbar below the sample card on a 390px phone", async () => {
    const demo = document.querySelector("swarm-loom") as HTMLElement & { player: { state: string } | null };
    // The toolbar stays pinned once the build is done (it auto-hides while building).
    await vi.waitFor(() => expect(demo.player?.state).toBe("done"), { timeout: 20_000, interval: 50 });
    const dock = toolbarDock();
    const card = document.querySelector(".sample")?.getBoundingClientRect();
    expect(dock && card).toBeTruthy();
    expect(dock?.getBoundingClientRect().top).toBeGreaterThanOrEqual((card?.bottom ?? 0) - 0.5);
  });
});
