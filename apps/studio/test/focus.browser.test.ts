/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import "../src/styles/studio.css";

/** Paints `colors` in order onto one canvas pixel and returns the blended sRGB channels. */
function paint(...colors: string[]): number[] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  for (const color of colors) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
  }
  return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
}

/** WCAG 2.x contrast ratio between two opaque sRGB colours. */
function contrast(a: number[], b: number[]): number {
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.body.replaceChildren();
});

describe("keyboard focus ring", () => {
  it.each(["light", "dark"])("keeps the seek slider ring at 3:1 or more in the %s theme", async (theme) => {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    const foot = document.createElement("div");
    foot.className = "player-foot";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "scrub-range";
    foot.append(slider);
    document.body.append(foot);

    await userEvent.keyboard("{Tab}");
    expect(slider.matches(":focus-visible")).toBe(true);

    // The ring sits outside the slider, over the footer background.
    const background = paint(getComputedStyle(foot).backgroundColor);
    const ring = paint(getComputedStyle(foot).backgroundColor, getComputedStyle(slider).outlineColor);
    expect(contrast(ring, background)).toBeGreaterThanOrEqual(3);
  });
});

describe("export progress bar", () => {
  // Forced colours: the user's palette sets the contrast; the fill only has to stay visible.
  it.each(["light", "dark", "forced"])("keeps the fill apart from its track in the %s theme", async (mode) => {
    if (mode === "dark") document.documentElement.dataset.theme = "dark";
    const forced = mode === "forced";
    if (forced) {
      await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    }
    try {
      const track = document.createElement("div");
      track.className = "export-progress";
      const fill = document.createElement("div");
      fill.className = "export-progress-fill";
      track.append(fill);
      document.body.append(track);

      const under = getComputedStyle(track).backgroundColor;
      const ratio = contrast(paint(under, getComputedStyle(fill).backgroundColor), paint(under));
      expect(ratio).toBeGreaterThanOrEqual(forced ? 1.5 : 3);
    } finally {
      if (forced) await cdp().send("Emulation.setEmulatedMedia", { features: [] });
    }
  });
});

describe("switch", () => {
  // Off is the state that faded into the panel: its outline and its knob need 3:1 as well.
  it.each(["light", "dark"])("keeps an off switch's outline and knob at 3:1 or more in the %s theme", (theme) => {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    const panel = document.createElement("div");
    panel.className = "panel";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "switch";
    panel.append(input);
    document.body.append(panel);

    const under = getComputedStyle(panel).backgroundColor;
    const style = getComputedStyle(input);
    const outline = style.boxShadow.match(/^(?:[a-z-]+\([^)]*\)|#\w+)/)?.[0] ?? "";
    const knob = paint(under, style.backgroundColor, getComputedStyle(input, "::before").backgroundColor);
    expect(contrast(paint(under, outline), paint(under))).toBeGreaterThanOrEqual(3);
    expect(contrast(knob, paint(under, style.backgroundColor))).toBeGreaterThanOrEqual(3);
  });
});
