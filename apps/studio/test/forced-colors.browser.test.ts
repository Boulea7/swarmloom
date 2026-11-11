import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import "../src/styles/studio.css";
import { segmented } from "../src/ui/controls";

/** Relative luminance of an sRGB pixel. */
function luminance(r: number, g: number, b: number): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * Contrast between the lightest and darkest pixel inside the label's text run, as painted.
 * Unreadable text (glyphs painted in the colour behind them) comes out at 1.
 */
async function textContrast(label: HTMLElement): Promise<number> {
  const box = label.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(label);
  const text = range.getBoundingClientRect();
  const base64 = await page.screenshot({ element: label, save: false });
  const img = new Image();
  img.src = `data:image/png;base64,${base64}`;
  await img.decode();
  const scale = img.naturalWidth / box.width;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0);
  // Inset by a pixel so antialiased edges of whatever surrounds the run do not count.
  const x = Math.ceil((text.left - box.left) * scale) + 1;
  const y = Math.ceil((text.top - box.top) * scale) + 1;
  const w = Math.floor(text.width * scale) - 2;
  const h = Math.floor(text.height * scale) - 2;
  const data = ctx.getImageData(x, y, w, h).data;
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = luminance(data[i] as number, data[i + 1] as number, data[i + 2] as number);
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  return (hi + 0.05) / (lo + 0.05);
}

beforeEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
});

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  document.body.replaceChildren();
});

describe("forced colours", () => {
  it("keeps the selected and the other segmented values readable", async () => {
    const control = segmented({
      legend: "Frame rate",
      name: "fps",
      choices: [
        { value: "30", label: "30 fps" },
        { value: "60", label: "60 fps" },
      ],
      value: "30",
      onChange: () => {},
    });
    document.body.append(control);
    expect(matchMedia("(forced-colors: active)").matches).toBe(true);

    const [selected, other] = [...control.querySelectorAll("label")] as HTMLElement[];
    expect(await textContrast(selected as HTMLElement)).toBeGreaterThanOrEqual(3);
    expect(await textContrast(other as HTMLElement)).toBeGreaterThanOrEqual(3);
  });
});
