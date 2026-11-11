import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { createI18n } from "../../src/i18n/index";
import type { Controls } from "../../src/internal";
import { createControls } from "../../src/ui/index";
import { createFakePlayer } from "./fake-player";

const frames = (n = 3) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

/** Mounts the toolbar the way the stage does: inside a full-viewport shadow root's UI layer. */
async function mount(opts: { locale: string; state: "building" | "done"; soundLocked?: boolean; finish?: boolean }) {
  const fake = createFakePlayer(opts.state);
  if (opts.finish) Object.assign(fake.player, { finish: vi.fn() });
  fake.setProgress(opts.state === "done" ? 40 : 12, 40);
  const stageHost = document.createElement("div");
  stageHost.style.cssText = "position:fixed;inset:0";
  document.body.append(stageHost);
  const uiLayer = document.createElement("div");
  uiLayer.style.cssText = "position:absolute;inset:0;pointer-events:none";
  stageHost.attachShadow({ mode: "closed" }).append(uiLayer);
  const controls = createControls({
    host: uiLayer,
    player: fake.player,
    i18n: createI18n(opts.locale),
    chrome: "light",
    soundLocked: () => opts.soundLocked ?? false,
    onUnlockSound: () => {},
  });
  await frames();
  const element = uiLayer.querySelector("swarmloom-controls") as HTMLElement;
  const root = element.shadowRoot as ShadowRoot;
  const visibleButtons = [...root.querySelectorAll<HTMLElement>("button, [role=progressbar]")].filter(
    (el) => el.getClientRects().length > 0,
  );
  return { controls, element, root, visibleButtons };
}

describe("toolbar layout in Chromium", () => {
  let controls: Controls | undefined;
  afterEach(() => {
    controls?.destroy();
    controls = undefined;
    document.body.replaceChildren();
  });

  it("uses the compact icons-only layout under 360px with 44px targets inside the viewport", async () => {
    await page.viewport(340, 720);
    const m = await mount({ locale: "es", state: "building", soundLocked: true });
    controls = m.controls;
    expect(m.element.hasAttribute("data-compact")).toBe(true);
    expect(m.visibleButtons.length).toBeGreaterThanOrEqual(6);
    for (const el of m.visibleButtons) {
      const r = el.getBoundingClientRect();
      expect(r.width, el.getAttribute("aria-label") ?? "").toBeGreaterThanOrEqual(44);
      expect(r.height, el.getAttribute("aria-label") ?? "").toBeGreaterThanOrEqual(44);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(340);
    }
    // Text labels are hidden; the "Tap for sound" hint floats above the bar, still on screen.
    const labels = [...m.root.querySelectorAll(".label")].filter((el) => el.getClientRects().length > 0);
    expect(labels).toHaveLength(0);
    const hint = m.root.querySelector(".hint")?.getBoundingClientRect();
    const bar = m.root.querySelector(".bar")?.getBoundingClientRect();
    expect(hint && bar && hint.bottom <= bar.top).toBe(true);
    expect(hint && hint.left >= 0 && hint.right <= 340).toBe(true);
  });

  it("keeps finish now on the one-row compact bar of a 390px phone while building", async () => {
    await page.viewport(390, 844);
    const m = await mount({ locale: "en", state: "building", finish: true });
    controls = m.controls;
    expect(m.element.hasAttribute("data-compact")).toBe(true);
    expect(m.visibleButtons.map((el) => el.getAttribute("data-cmd"))).toContain("finish");
    const bar = m.root.querySelector(".bar")?.getBoundingClientRect();
    expect(bar?.height).toBeLessThan(2 * 44);
  });

  it("shows the labelled full layout with go live as primary on a wide screen when done", async () => {
    await page.viewport(1280, 800);
    const m = await mount({ locale: "en", state: "done" });
    controls = m.controls;
    expect(m.element.hasAttribute("data-compact")).toBe(false);
    const goLive = m.root.querySelector<HTMLElement>('[data-cmd="goLive"]');
    expect(goLive?.classList.contains("primary")).toBe(true);
    expect(goLive?.textContent).toContain("Go live");
    const bar = m.root.querySelector(".bar")?.getBoundingClientRect();
    // Bottom-centred pill.
    expect(bar && Math.abs(bar.left + bar.width / 2 - 640)).toBeLessThan(2);
    expect(bar && 800 - bar.bottom).toBeGreaterThanOrEqual(12);
  });
});
