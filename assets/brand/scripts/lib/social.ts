import {
  bars,
  box,
  caret,
  cloth,
  hue,
  type Kit,
  kitDefs,
  pointer,
  selectBox,
  stitch,
  windowFrame,
} from "./cards/kit.ts";
import { textWidth, UI_FONT } from "./cursor.ts";
import { LOGOTYPE_METRICS } from "./glyphs.ts";
import { LOCKUP, placeLogotype } from "./logotype.ts";
import { MARK_GRID, markBody, markStyles } from "./mark.ts";
import type { Palette } from "./palette.ts";
import { el, esc, n, svgDoc } from "./svg.ts";
import { type Theme, themes } from "./theme.ts";

// Social images: the GitHub social preview and the Open Graph cards. They exist only as PNGs
// (rasterised by scripts/rasterize.ts), so text may use the committed display face and the system
// CJK face instead of outlines; the rasteriser registers both before capturing.

/** Family name the rasteriser registers for the committed Bricolage Grotesque files. */
export const DISPLAY_FAMILY = "SL Display";

/** Chinese text: system CJK faces, Simplified Chinese forms first. */
export const CJK_FONT =
  '"Noto Sans CJK SC","Noto Sans SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",sans-serif';

/** Canvas sizes required by contracts/brand.md. */
export const SOCIAL_SIZE = { width: 1280, height: 640 } as const;
export const OG_SIZE = { width: 1200, height: 630 } as const;

/** Language of an Open Graph card. */
export type OgLang = "zh" | "en";

/** A run of headline text; `hi` paints it in the primary colour. */
type Run = { text: string; hi?: boolean };

/** Copy and type scale of one Open Graph card. Lines are broken by hand so layout never depends on the text engine. */
interface OgCopy {
  headline: Run[][];
  sub: string[];
  /** Headline font size, line pitch and first baseline (px). */
  size: number;
  leading: number;
  top: number;
  /** Class selecting the font stack (see {@link fontCss}). */
  face: "zh" | "en";
}

const OG_COPY: Record<OgLang, OgCopy> = {
  zh: {
    headline: [[{ text: "让一群" }, { text: "光标", hi: true }, { text: "，" }], [{ text: "把它织出来。" }]],
    sub: ["网页、文档、PDF、幻灯片、代码和 3D 模型，", "在你眼前被重新织出来，还能导出成视频。"],
    size: 76,
    leading: 96,
    top: 258,
    face: "zh",
  },
  en: {
    headline: [
      [{ text: "Watch a swarm" }],
      [{ text: "of " }, { text: "cursors", hi: true }, { text: " weave" }],
      [{ text: "it into being." }],
    ],
    sub: ["Web pages, docs, PDF, slides, code and 3D,", "rebuilt live in front of you. Export as video."],
    size: 60,
    leading: 64,
    top: 222,
    face: "en",
  },
};

/** Public repository shown in the footer of the cards. */
const REPO = "github.com/Boulea7/swarmloom";

function fontCss(): string {
  return [
    `.zh{font-family:${CJK_FONT}}`,
    `.en{font-family:"${DISPLAY_FAMILY}",${UI_FONT}}`,
    `.ui,text{font-family:${UI_FONT}}`,
  ].join("");
}

/** Text with explicit typography; the body is escaped. */
function text(x: number, y: number, body: string, attrs: Record<string, string | number>): string {
  return el("text", { x, y, ...attrs }, esc(body));
}

/** Background cloth: faint vertical warp threads that fade out behind the focal area. */
function backdrop(
  theme: Theme,
  w: number,
  h: number,
  focus: { cx: number; cy: number; rx: number; ry: number },
): string {
  let warp = "";
  for (let x = 24; x < w; x += 24) warp += `M${x} 0V${h}`;
  return [
    el(
      "defs",
      {},
      el(
        "radialGradient",
        {
          id: "bf",
          cx: focus.cx,
          cy: focus.cy,
          r: focus.rx,
          gradientUnits: "userSpaceOnUse",
          gradientTransform: `translate(${n(focus.cx)} ${n(focus.cy)}) scale(1 ${n(focus.ry / focus.rx)}) translate(${n(-focus.cx)} ${n(-focus.cy)})`,
        },
        el("stop", { offset: 0.5, "stop-color": theme.bg }),
        el("stop", { offset: 1, "stop-color": theme.bg, "stop-opacity": 0 }),
      ),
    ),
    el("rect", { width: w, height: h, fill: theme.bg }),
    el("path", { d: warp, stroke: theme.faint, "stroke-width": 1 }),
    el("rect", { width: w, height: h, fill: "url(#bf)" }),
  ].join("");
}

/** Mark plus outlined logotype, in wordmark.svg proportions, with the mark's top-left corner at (x, y). */
function lockup(
  p: Palette,
  theme: Theme,
  x: number,
  y: number,
  markSize: number,
  id: string,
): { svg: string; right: number; capTop: number } {
  const scale = markSize / LOCKUP.mark;
  const baseline = y + LOCKUP.baseline * scale;
  const glyphs = placeLogotype(x + (LOCKUP.mark + LOCKUP.gap) * scale, baseline, scale);
  const mark = el(
    "g",
    { transform: `translate(${n(x)} ${n(y)}) scale(${n(markSize / MARK_GRID)})` },
    markBody(markStyles(p)[theme.scheme], { id }),
  );
  const word = el("path", { fill: theme.ink, d: glyphs.map((g) => g.d).join("") });
  return {
    svg: mark + word,
    right: x + (LOCKUP.mark + LOCKUP.gap + LOGOTYPE_METRICS.width) * scale,
    capTop: baseline - LOGOTYPE_METRICS.capHeight * scale,
  };
}

/** A cursor with its name tag, scaled up for images that are viewed downsized (link previews). */
function weaver(k: Kit, x: number, y: number, colorIndex: number, label: string, scale: number): string {
  return el("g", { transform: `translate(${n(x)} ${n(y)}) scale(${n(scale)})` }, pointer(k, 0, 0, colorIndex, label));
}

/**
 * The Open Graph illustration: a web page halfway through being woven, in a local 340 x 316 space.
 * Headline and copy are already in, a feature card is being dragged out of the cloth and the footer
 * is still unwoven, with four named cursors at work.
 */
function wovenPage(k: Kit): string {
  const t = k.theme;
  const indigo = hue(k, 0);
  const sky = hue(k, 5);
  const featureCard = (x: number, colorIndex: number) =>
    box(x, 170, 98, 60, 8, { fill: t.placeholder }) +
    el("circle", { cx: x + 17, cy: 187, r: 7, fill: hue(k, colorIndex) }) +
    bars(x + 10, 203, [72, 50], t.bar, { h: 4, gap: 9 });
  return [
    windowFrame(k, 0, 0, 340, 316, { url: true }),
    box(14, 30, 10, 10, 3, { fill: indigo }),
    bars(232, 33, [24], t.bar),
    bars(262, 33, [24], t.bar),
    bars(292, 33, [32], t.bar),
    bars(14, 54, [150, 104], t.ink, { h: 11, gap: 18 }),
    bars(14, 98, [140, 124, 88], t.bar, { h: 5, gap: 10 }),
    box(14, 136, 60, 18, 9, { fill: indigo }),
    box(184, 52, 142, 102, 8, { fill: sky, "fill-opacity": 0.18 }),
    el("path", { d: "M194 146l30-28 20 16 34-38 38 50z", fill: sky, "fill-opacity": 0.55 }),
    el("circle", { cx: 302, cy: 74, r: 9, fill: hue(k, 3) }),
    featureCard(14, 2),
    featureCard(121, 4),
    cloth(228, 170, 98, 60, 8),
    selectBox(228, 170, 98, 60, k.palette.select, "98 × 60"),
    bars(14, 258, [312, 270], t.bar, { h: 5, gap: 11 }),
    stitch(k, 14, 285, 240, 285),
    cloth(14, 290, 226, 14, 4),
    caret(123, 70, 14, hue(k, 1)),
    pointer(k, 125, 84, 1, "茜红"),
    pointer(k, 262, 120, 2, "铜绿"),
    pointer(k, 300, 214, 0, "Indigo"),
    pointer(k, 204, 298, 3, "Weld"),
  ].join("");
}

/** Soft shadow lifting the illustration window off the cloth. */
function liftFilter(theme: Theme): string {
  const o = theme.scheme === "dark" ? 0.5 : 0.1;
  return el(
    "filter",
    { id: "lift", x: "-20%", y: "-20%", width: "140%", height: "150%", "color-interpolation-filters": "sRGB" },
    el("feDropShadow", { dx: 0, dy: 2, stdDeviation: 2, "flood-color": "#0B0B12", "flood-opacity": o }),
    el("feDropShadow", { dx: 0, dy: 18, stdDeviation: 22, "flood-color": "#0B0B12", "flood-opacity": o }),
  );
}

/** Open Graph card (1200 x 630): lockup, headline and copy on the left, a page being woven on the right. */
export function ogSvg(p: Palette, lang: OgLang): string {
  const theme = themes(p).light;
  const copy = OG_COPY[lang];
  const { width: w, height: h } = OG_SIZE;
  const k: Kit = { theme, palette: p, css: [] };
  const left = 72;
  const brand = lockup(p, theme, left, 64, 48, "om");
  const headline = copy.headline
    .map((line, i) =>
      el(
        "text",
        {
          x: left,
          y: copy.top + i * copy.leading,
          class: copy.face,
          "font-size": copy.size,
          "font-weight": 700,
          fill: theme.ink,
          "letter-spacing": copy.face === "en" ? -1.2 : 1,
        },
        line.map((r) => (r.hi ? el("tspan", { fill: p.primary }, esc(r.text)) : esc(r.text))).join(""),
      ),
    )
    .join("");
  const subTop = copy.top + (copy.headline.length - 1) * copy.leading + 70;
  const sub = copy.sub
    .map((line, i) =>
      text(left, subTop + i * 34, line, {
        class: copy.face,
        "font-size": 22,
        "font-weight": copy.face === "zh" ? 400 : 500,
        fill: theme.ink2,
      }),
    )
    .join("");
  const footer = text(left, h - 62, REPO, { class: "en", "font-size": 18, "font-weight": 500, fill: theme.muted });
  const art = el("g", { transform: "translate(632 78) scale(1.5)", filter: "url(#lift)" }, wovenPage(k));
  const body = [
    backdrop(theme, w, h, { cx: 330, cy: 320, rx: 420, ry: 300 }),
    kitDefs(k),
    el("defs", {}, liftFilter(theme)),
    brand.svg,
    headline,
    sub,
    footer,
    art,
  ].join("");
  const title = lang === "zh" ? `${p.nameZh} ${p.name}：${p.tagline.zh}` : `${p.name}: ${p.tagline.en}`;
  return svgDoc(body, { width: w, height: h, title, style: fontCss() });
}

/** Formats shown as chips on the social preview, each with a palette dot. */
const CHIPS = ["Web", "Markdown", "DOCX", "PDF", "HTML/SVG", "PPTX", "XLSX", "Code", "Images", "3D", "Video"] as const;

function chipRow(k: Kit, cy: number, width: number): string {
  const size = 15;
  const pad = 14;
  const dot = 8;
  const gap = 10;
  const widths = CHIPS.map((c) => Math.ceil(textWidth(c, size) + pad * 2 + dot + 8));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (CHIPS.length - 1);
  let x = (width - total) / 2;
  const h = 34;
  return CHIPS.map((c, i) => {
    const w = widths[i] ?? 0;
    const chip = [
      box(x, cy - h / 2, w, h, h / 2, { fill: k.theme.surface, stroke: k.theme.line }),
      el("circle", { cx: x + pad + dot / 2, cy, r: dot / 2, fill: hue(k, i) }),
      text(x + pad + dot + 8, cy + size * 0.36, c, {
        class: "ui",
        "font-size": size,
        "font-weight": 600,
        fill: k.theme.ink2,
      }),
    ].join("");
    x += w + gap;
    return chip;
  }).join("");
}

/** GitHub social preview (1280 x 640): centred lockup, bilingual tagline, format chips and the swarm at rest. */
export function socialPreviewSvg(p: Palette): string {
  const theme = themes(p).light;
  const { width: w, height: h } = SOCIAL_SIZE;
  const k: Kit = { theme, palette: p, css: [] };
  const markSize = 120;
  const probe = lockup(p, theme, 0, 0, markSize, "sp");
  const x0 = (w - probe.right) / 2;
  const markY = 150;
  const brand = lockup(p, theme, x0, markY, markSize, "sp");
  const zhY = 362;
  const enY = 404;
  const zhSize = 36;
  const zhHalf = ([...p.tagline.zh].length * zhSize) / 2;
  const s = 1.45;
  const cursors = [
    weaver(k, x0 - 92, markY - 8, 5, "天青", s),
    weaver(k, brand.right + 14, brand.capTop + 12, 0, "Indigo", s),
    weaver(k, x0 + markSize + 0.52 * (brand.right - x0 - markSize), brand.capTop - 60, 3, "Weld", s),
    weaver(k, w / 2 - zhHalf - 92, zhY - 44, 1, "茜红", s),
    weaver(k, w / 2 + zhHalf + 22, zhY - 8, 2, "铜绿", s),
    weaver(k, brand.right - 150, enY + 22, 4, "Tyrian", s),
  ].join("");
  const body = [
    backdrop(theme, w, h, { cx: w / 2, cy: 300, rx: 620, ry: 250 }),
    kitDefs(k),
    el("rect", { x: 0.5, y: 0.5, width: w - 1, height: h - 1, stroke: theme.line, fill: "none" }),
    brand.svg,
    text(w / 2, zhY, p.tagline.zh, {
      class: "zh",
      "font-size": zhSize,
      fill: theme.ink2,
      "text-anchor": "middle",
      "letter-spacing": 1,
    }),
    text(w / 2, enY, p.tagline.en, {
      class: "en",
      "font-size": 22,
      "font-weight": 500,
      fill: theme.muted,
      "text-anchor": "middle",
    }),
    chipRow(k, 512, w),
    cursors,
  ].join("");
  return svgDoc(body, { width: w, height: h, title: `${p.name} (${p.nameZh}): ${p.tagline.en}`, style: fontCss() });
}
