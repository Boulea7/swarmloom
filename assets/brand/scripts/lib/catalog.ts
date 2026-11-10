import { cardAssets } from "./cards/index.ts";
import { heroSvg } from "./hero.ts";
import { wordmarkSvg } from "./logotype.ts";
import { faviconSvg, markStyles, markSvg } from "./mark.ts";
import type { Palette } from "./palette.ts";
import { themes } from "./theme.ts";

/** A generated vector asset: path relative to assets/brand and its full contents. */
export interface VectorAsset {
  file: string;
  svg: string;
}

/** Identity SVGs: marks, lockups and the favicon. Pure function of the palette. */
export function identityAssets(p: Palette): VectorAsset[] {
  const s = markStyles(p);
  return [
    { file: "logo.svg", svg: markSvg(s.light, 512) },
    { file: "logo-dark.svg", svg: markSvg(s.dark, 512) },
    // Full-bleed tile with the artwork inside the 80% safe zone; source of icon-maskable-512.png.
    { file: "logo-maskable.svg", svg: markSvg(s.maskable, 512) },
    { file: "favicon.svg", svg: faviconSvg(p) },
    { file: "wordmark.svg", svg: wordmarkSvg(s.light, p.neutrals.ink) },
    { file: "wordmark-dark.svg", svg: wordmarkSvg(s.dark, p.neutrals.paper) },
  ];
}

/** Animated README banners in both schemes. */
export function heroAssets(p: Palette): VectorAsset[] {
  const t = themes(p);
  return [
    { file: "hero-light.svg", svg: heroSvg(p, t.light) },
    { file: "hero-dark.svg", svg: heroSvg(p, t.dark) },
  ];
}

/** Every committed SVG, in a stable order. Deterministic: same palette, same bytes. */
export function vectorAssets(p: Palette): VectorAsset[] {
  return [...identityAssets(p), ...heroAssets(p), ...cardAssets(p)];
}
