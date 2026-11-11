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
async function mount(opts: {
  locale: string;
  state: "building" | "done";
  soundLocked?: boolean;
  finish?: boolean;
  seekable?: boolean;
}) {
  const fake = createFakePlayer(opts.state);
  if (opts.finish) Object.assign(fake.player, { finish: vi.fn() });
  const seekable = opts.seekable ? { timeline: () => ({ elapsed: 4000, duration: 16_000 }) } : {};
  if (opts.seekable) Object.assign(fake.player, { seek: vi.fn() });
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
    ...seekable,
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

  it("runs the seek bar across the top of the pill without widening it or forcing the compact layout", async () => {
    await page.viewport(1280, 800);
    const plain = await mount({ locale: "en", state: "building" });
    const plainWidth = plain.root.querySelector(".bar")?.getBoundingClientRect().width ?? 0;
    plain.controls.destroy();
    const m = await mount({ locale: "en", state: "building", seekable: true });
    controls = m.controls;
    expect(m.element.hasAttribute("data-compact")).toBe(false);
    const bar = m.root.querySelector(".bar")?.getBoundingClientRect();
    const seek = m.root.querySelector<HTMLInputElement>(".seek");
    const track = seek?.getBoundingClientRect();
    const ring = m.root.querySelector(".ring")?.getBoundingClientRect();
    expect(bar && Math.abs(bar.width - plainWidth)).toBeLessThan(1);
    // Spans the pill (inset to line up with the ring's centre), centred on it.
    expect(track && bar && track.width).toBeGreaterThan((bar?.width ?? 0) - 40);
    expect(track && bar && Math.abs(track.left + track.width / 2 - (bar.left + bar.width / 2))).toBeLessThan(1);
    expect(track && ring && track.bottom <= ring.top).toBe(true);
    // A real tab stop, read as a slider with a spoken position.
    seek?.focus();
    expect(m.root.activeElement).toBe(seek);
    expect(seek?.getAttribute("aria-valuetext")).toBe("0:04 of 0:16");
  });
});
