/// <reference path="../assets.d.ts" />
/**
 * KaTeX style sheet and fonts, bundled so a blueprint with math needs no network.
 * Each font is a separate lazily imported data URL chunk; only the families a document uses load.
 */
import katexCss from "katex/dist/katex.min.css?raw";

export { katexCss };

/** Loaders keyed by font file stem (as referenced from katex.min.css). */
export const KATEX_FONTS: Record<string, () => Promise<{ default: string }>> = {
  "KaTeX_AMS-Regular": () => import("katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline"),
  "KaTeX_Caligraphic-Bold": () => import("katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline"),
  "KaTeX_Caligraphic-Regular": () => import("katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline"),
  "KaTeX_Fraktur-Bold": () => import("katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline"),
  "KaTeX_Fraktur-Regular": () => import("katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline"),
  "KaTeX_Main-BoldItalic": () => import("katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline"),
  "KaTeX_Main-Bold": () => import("katex/dist/fonts/KaTeX_Main-Bold.woff2?inline"),
  "KaTeX_Main-Italic": () => import("katex/dist/fonts/KaTeX_Main-Italic.woff2?inline"),
  "KaTeX_Main-Regular": () => import("katex/dist/fonts/KaTeX_Main-Regular.woff2?inline"),
  "KaTeX_Math-BoldItalic": () => import("katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline"),
  "KaTeX_Math-Italic": () => import("katex/dist/fonts/KaTeX_Math-Italic.woff2?inline"),
  "KaTeX_SansSerif-Bold": () => import("katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline"),
  "KaTeX_SansSerif-Italic": () => import("katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline"),
  "KaTeX_SansSerif-Regular": () => import("katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline"),
  "KaTeX_Script-Regular": () => import("katex/dist/fonts/KaTeX_Script-Regular.woff2?inline"),
  "KaTeX_Size1-Regular": () => import("katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline"),
  "KaTeX_Size2-Regular": () => import("katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline"),
  "KaTeX_Size3-Regular": () => import("katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline"),
  "KaTeX_Size4-Regular": () => import("katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline"),
  "KaTeX_Typewriter-Regular": () => import("katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline"),
};
