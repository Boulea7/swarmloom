import { readFileSync } from "node:fs";
import { join } from "node:path";
import { page } from "./browser.ts";
import type { Palette } from "./palette.ts";
import { BRAND_DIR, DISPLAY_FONT, DISPLAY_FONT_MEDIUM } from "./paths.ts";
import { DISPLAY_FAMILY, OG_SIZE, ogSvg, SOCIAL_SIZE, socialPreviewSvg } from "./social.ts";

/** One PNG to export: file name under assets/brand, pixel size, alpha policy and the page to capture. */
export interface RasterJob {
  file: string;
  width: number;
  height: number;
  /** true: corners outside the tile stay fully transparent; false: every pixel is opaque. */
  transparent: boolean;
  html: () => string;
}

/** App icon sizes from contracts/brand.md; the small ones use the heavier favicon threads. */
export const ICON_SIZES = [16, 32, 48, 128, 192, 512] as const;

/** Largest size that still uses the favicon rendition (thicker threads that survive downsampling). */
const FAVICON_MAX = 48;

const dataUrl = (mime: string, bytes: Buffer | string) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

/** Page that shows a committed SVG as an image, exactly `size` CSS px square, on a transparent page. */
function svgImagePage(file: string, size: number): string {
  const svg = readFileSync(join(BRAND_DIR, file));
  return page(`<img src="${dataUrl("image/svg+xml", svg)}" width="${size}" height="${size}" alt="">`, {
    css: "img{display:block}",
  });
}

/** @font-face rules for the committed display face (Bricolage Grotesque, SIL OFL 1.1). */
function displayFaces(): string {
  const face = (file: string, weight: number) =>
    `@font-face{font-family:"${DISPLAY_FAMILY}";font-weight:${weight};font-style:normal;src:url(${dataUrl("font/woff2", readFileSync(file))}) format("woff2")}`;
  return face(DISPLAY_FONT_MEDIUM, 500) + face(DISPLAY_FONT, 700);
}

/** Page for an inline social SVG, with the display face loaded and Chinese language tagging for CJK shaping. */
function socialPage(svg: string, lang: string): string {
  return page(svg, { css: displayFaces() }).replace("<html>", `<html lang="${lang}">`);
}

/** Every PNG the brand zone ships, in a stable order. */
export function rasterJobs(p: Palette): RasterJob[] {
  const icons = ICON_SIZES.map(
    (size): RasterJob => ({
      file: `icon-${size}.png`,
      width: size,
      height: size,
      transparent: true,
      html: () => svgImagePage(size <= FAVICON_MAX ? "favicon.svg" : "logo.svg", size),
    }),
  );
  return [
    ...icons,
    {
      file: "icon-maskable-512.png",
      width: 512,
      height: 512,
      transparent: false,
      html: () => svgImagePage("logo-maskable.svg", 512),
    },
    {
      file: "social-preview.png",
      ...SOCIAL_SIZE,
      transparent: false,
      html: () => socialPage(socialPreviewSvg(p), "zh-Hans"),
    },
    { file: "og-zh.png", ...OG_SIZE, transparent: false, html: () => socialPage(ogSvg(p, "zh"), "zh-Hans") },
    { file: "og-en.png", ...OG_SIZE, transparent: false, html: () => socialPage(ogSvg(p, "en"), "en") },
  ];
}
