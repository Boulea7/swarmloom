import type { Blueprint, BoxLayer, CSSMap, GuideLayer, Layer, PathLayer, Rect, TextLayer } from "@swarmloom/core";
import { type Highlighted, lineText, lineToHtml, type TokenLine } from "../syntax/highlight";
import type { CodeTheme } from "../syntax/themes";
import { escapeHtml } from "../util/escape";
import { columnWidth } from "../util/width";
import { indentGuides, leadingSpaces } from "./indent";

/** Monospace stack shared by the editor panel and Markdown code blocks (CJK fallbacks included). */
export const MONO_FONT =
  '"JetBrains Mono", "SF Mono", ui-monospace, "Cascadia Code", Menlo, Consolas, "Liberation Mono", ' +
  '"Noto Sans Mono CJK SC", "Noto Sans Mono", monospace';

/** Interface stack for the title bar. */
export const UI_FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", ' +
  '"Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

/** Brand indigo used for the language badge. */
const BADGE = "#5B5BF7";

/** Measures the advance width of `text` in CSS px for a CSS `font` shorthand. */
export type MeasureText = (text: string, font: string) => number;

export interface EditorLayoutOptions {
  /** World width in CSS px. */
  width: number;
  theme: CodeTheme;
  /** Shown in the title bar. */
  fileName: string;
  url?: string;
  /** Advance width of one monospace column divided by the font size. Default 0.6. */
  charRatio?: number;
  /** Text measurement for the proportional title bar labels. Default: a width estimate. */
  measure?: MeasureText;
  /** Layer budget (Blueprint.truncated is set when lines are dropped). Default 6000. */
  maxLayers?: number;
  /** Hard cap on rendered lines. Default 1500. */
  maxLines?: number;
  /** Font size range in px; the largest size that fits the longest line is used. Default 10..15. */
  fontSize?: { min: number; max: number };
  /** BCP 47 locale for the line count label. */
  locale?: string;
  /** Extra note (e.g. a highlighter warning) stored in the panel layer meta. */
  warning?: string;
}

/** Geometry of the laid-out panel, exposed for tests and for callers that add decorations. */
export interface EditorMetrics {
  fontSize: number;
  lineHeight: number;
  charWidth: number;
  panel: Rect;
  code: Rect;
  shownLines: number;
  totalLines: number;
}

const PANEL_RADIUS = 14;
const TITLE_H = 44;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;
const PAD_LEFT = 18;
const PAD_RIGHT = 22;
const GUTTER_PAD = 14;
const FIXED_LAYERS = 10;
const DEFAULT_MAX_LINES = 1500;
const DEFAULT_MAX_LAYERS = 6000;
/** Indent guides are skipped on very long files to keep the layer count and the build short. */
const GUIDE_LINE_LIMIT = 800;

/**
 * Build order tiers (Layer.priority, lower first): the panel and title bar, then the indent
 * guides as a skeleton, then the code itself, then the line numbers.
 */
const TIER_GUIDES = 1;
const TIER_CODE = 2;
const TIER_LINE_NUMBERS = 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const px = (n: number) => `${round(n)}px`;
const round = (n: number) => Math.round(n * 100) / 100;

/** Rough proportional text width when no canvas is available: 0.56 em per Latin glyph, 1 em per wide glyph. */
export function estimateTextWidth(text: string, font: string): number {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 13);
  let w = 0;
  for (const ch of text) w += columnWidth(ch) === 2 ? 1 : 0.56;
  return w * size;
}

function lineCountLabel(n: number, locale?: string): string {
  const lang = (locale ?? "en").toLowerCase();
  if (lang.startsWith("zh") || lang.startsWith("ja")) return `${n} 行`;
  if (lang.startsWith("ko")) return `${n}줄`;
  return n === 1 ? "1 line" : `${n} lines`;
}

/** Drops leading whitespace tokens so a line layer starts where its code starts. */
function trimLeading(line: TokenLine): TokenLine {
  const out: TokenLine = [];
  let started = false;
  for (const t of line) {
    if (started) {
      out.push(t);
      continue;
    }
    const text = t.text.replace(/^ +/, "");
    if (!text) continue;
    started = true;
    out.push(text === t.text ? t : { text, scope: t.scope });
  }
  return out;
}

/** An original file icon for the intro orbit: indigo tile with a code glyph. */
function editorIcon(theme: CodeTheme): string {
  const fg = theme.scheme === "dark" ? "#14141F" : "#FFFFFF";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect x="4" y="4" width="56" height="56" rx="16" fill="${BADGE}"/>` +
    `<path d="M25 22 15 32l10 10M39 22l10 10-10 10M35 18l-6 28" fill="none" stroke="${fg}" stroke-width="4.5" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Lays out highlighted code as an editor panel: a window with a title bar (language badge, file
 * name, line count), a line-number gutter and one text layer per non-blank line. Soft wrap is off;
 * the font size shrinks (down to `fontSize.min`) until the longest line fits, and lines that
 * still overflow are clipped to the code area. Pure: no DOM access.
 */
export function layoutEditor(
  src: Highlighted,
  opts: EditorLayoutOptions,
): { blueprint: Blueprint; metrics: EditorMetrics } {
  if (!Number.isFinite(opts.width) || opts.width <= 0)
    throw new RangeError(`code: width must be a positive number, got ${opts.width}`);
  const theme = opts.theme;
  const W = Math.round(clamp(opts.width, 320, 2560));
  const ratio = opts.charRatio && opts.charRatio > 0.3 && opts.charRatio < 1 ? opts.charRatio : 0.6;
  const measure = opts.measure ?? estimateTextWidth;
  const sizeRange = opts.fontSize ?? { min: 10, max: 15 };

  const source = src.lines.length > 0 ? src.lines : [[]];
  const totalLines = source.length;
  const maxLayers = Math.max(FIXED_LAYERS + 2, opts.maxLayers ?? DEFAULT_MAX_LAYERS);
  const budget = Math.floor((maxLayers - FIXED_LAYERS) / 2);
  const shown = Math.max(1, Math.min(totalLines, opts.maxLines ?? DEFAULT_MAX_LINES, budget));
  const lines = source.slice(0, shown);

  const texts = lines.map(lineText);
  const indents = texts.map((t) => (t.trim() === "" ? null : leadingSpaces(t)));
  const cols = texts.map((t) => columnWidth(t.trimEnd()));
  const maxCols = Math.max(24, ...cols);
  const digits = Math.max(2, String(shown).length);

  const margin = W >= 720 ? 40 : 14;
  const panelW = Math.min(W - 2 * margin, 1120);
  const panelX = Math.round((W - panelW) / 2);
  const panelY = margin;

  const fit = (panelW - PAD_LEFT - PAD_RIGHT - 2 * GUTTER_PAD) / (ratio * (maxCols + digits));
  const fontSize = clamp(Math.floor(fit * 2) / 2, sizeRange.min, sizeRange.max);
  const cw = fontSize * ratio;
  const lh = Math.round(fontSize * 1.6);
  const gutterW = Math.round(digits * cw + 2 * GUTTER_PAD);
  const codeX = Math.round(panelX + gutterW + PAD_LEFT);
  const codeY = panelY + TITLE_H + PAD_TOP;
  const codeW = panelX + panelW - PAD_RIGHT - codeX;
  const bodyH = PAD_TOP + shown * lh + PAD_BOTTOM;
  const panelH = TITLE_H + bodyH;
  const H = panelY + panelH + margin;
  const codeRect: Rect = { x: codeX, y: codeY, w: codeW, h: shown * lh };

  const layers: Layer[] = [];
  const monoStyle = (color: string, extra?: CSSMap): CSSMap => ({
    "font-family": MONO_FONT,
    "font-size": px(fontSize),
    "line-height": px(lh),
    "white-space": "pre",
    "font-variant-ligatures": "none",
    color,
    ...extra,
  });

  const panel: BoxLayer = {
    id: "panel",
    kind: "box",
    role: "section",
    box: { x: panelX, y: panelY, w: panelW, h: panelH },
    style: {
      "background-color": theme.background,
      border: `1px solid ${theme.border}`,
      "border-radius": px(PANEL_RADIUS),
      "box-shadow": theme.shadow,
    },
    meta: { language: src.language.id, ...(opts.warning ? { warning: opts.warning } : {}) },
  };
  const titleBar: BoxLayer = {
    id: "title-bar",
    kind: "box",
    role: "nav",
    parent: panel.id,
    box: { x: panelX, y: panelY, w: panelW, h: TITLE_H },
    style: {
      "background-color": theme.titleBar,
      "border-bottom": `1px solid ${theme.border}`,
      "border-radius": `${PANEL_RADIUS}px ${PANEL_RADIUS}px 0 0`,
    },
  };
  layers.push(panel, titleBar);

  const badgeFont = `700 11px ${UI_FONT}`;
  const badgeText = src.language.short;
  const badgeW = Math.round(Math.max(26, measure(badgeText, badgeFont) + 14));
  const badge: BoxLayer = {
    id: "badge",
    kind: "box",
    role: "button",
    parent: titleBar.id,
    box: { x: panelX + 14, y: panelY + (TITLE_H - 22) / 2, w: badgeW, h: 22 },
    style: { "background-color": BADGE, "border-radius": "6px" },
  };
  const badgeLabel: TextLayer = {
    id: "badge-label",
    kind: "text",
    role: "label",
    parent: badge.id,
    box: { ...badge.box },
    html: escapeHtml(badgeText),
    text: badgeText,
    fontSize: 11,
    reveal: "stamp",
    style: {
      "font-family": UI_FONT,
      "font-size": "11px",
      "font-weight": "700",
      "line-height": "22px",
      "letter-spacing": "0.04em",
      "text-align": "center",
      color: "#FFFFFF",
      "white-space": "nowrap",
    },
  };
  layers.push(badge, badgeLabel);

  const infoText = `${src.language.label} · ${lineCountLabel(totalLines, opts.locale)}`;
  const infoFont = `500 12px ${UI_FONT}`;
  const infoW = Math.round(measure(infoText, infoFont) + 4);
  const infoX = panelX + panelW - 16 - infoW;
  const nameX = badge.box.x + badgeW + 10;
  const nameW = Math.max(40, infoX - 12 - nameX);
  layers.push({
    id: "file-name",
    kind: "text",
    role: "heading",
    parent: titleBar.id,
    box: { x: nameX, y: panelY + (TITLE_H - 20) / 2, w: nameW, h: 20 },
    html: escapeHtml(opts.fileName),
    text: opts.fileName,
    fontSize: 13,
    reveal: "type",
    clip: { x: nameX, y: panelY, w: nameW, h: TITLE_H },
    style: {
      "font-family": UI_FONT,
      "font-size": "13px",
      "font-weight": "600",
      "line-height": "20px",
      color: theme.titleText,
      "white-space": "nowrap",
      overflow: "hidden",
      "text-overflow": "ellipsis",
    },
  } satisfies TextLayer);
  layers.push({
    id: "file-info",
    kind: "text",
    role: "paragraph",
    parent: titleBar.id,
    box: { x: infoX, y: panelY + (TITLE_H - 18) / 2, w: infoW, h: 18 },
    html: escapeHtml(infoText),
    text: infoText,
    fontSize: 12,
    reveal: "fade",
    style: {
      "font-family": UI_FONT,
      "font-size": "12px",
      "font-weight": "500",
      "line-height": "18px",
      "text-align": "right",
      color: theme.muted,
      "white-space": "nowrap",
    },
  } satisfies TextLayer);

  const gutter: BoxLayer = {
    id: "gutter",
    kind: "box",
    role: "section",
    parent: panel.id,
    box: { x: panelX, y: panelY + TITLE_H, w: gutterW, h: bodyH },
    style: {
      "background-color": theme.gutter,
      "border-right": `1px solid ${theme.border}`,
      "border-radius": `0 0 0 ${PANEL_RADIUS}px`,
    },
  };
  layers.push(gutter);

  const guideId = "code-edge";
  const withGuide = shown >= 3;
  if (withGuide) {
    layers.push({
      id: guideId,
      kind: "guide",
      axis: "x",
      pos: codeX,
      box: { x: codeX, y: codeY, w: 0, h: shown * lh },
    } satisfies GuideLayer);
  }

  if (shown <= GUIDE_LINE_LIMIT) {
    for (const g of indentGuides(indents)) {
      const x = Math.round(codeX + g.col * cw) + 0.5;
      const y1 = codeY + g.from * lh + 2;
      const y2 = codeY + (g.to + 1) * lh - 2;
      layers.push({
        id: `indent-${g.col}-${g.from + 1}`,
        kind: "path",
        role: "shape",
        parent: panel.id,
        box: { x: x - 0.5, y: y1, w: 1, h: y2 - y1 },
        d: `M${x} ${y1}V${y2}`,
        stroke: theme.indentGuide,
        strokeWidth: 1,
        reveal: "pen",
        priority: TIER_GUIDES,
      } satisfies PathLayer);
    }
  }

  for (let i = 0; i < shown; i++) {
    const y = codeY + i * lh;
    const n = String(i + 1);
    layers.push({
      id: `ln-${n}`,
      kind: "text",
      role: "line-number",
      parent: gutter.id,
      box: { x: panelX + GUTTER_PAD, y, w: round(digits * cw), h: lh },
      html: n,
      text: n,
      fontSize,
      reveal: "stamp",
      priority: TIER_LINE_NUMBERS,
      style: monoStyle(theme.gutterText, { "text-align": "right" }),
      meta: { line: i + 1 },
    } satisfies TextLayer);

    const indent = indents[i];
    if (indent === null || indent === undefined) continue;
    const tokens = trimLeading(lines[i] ?? []);
    const text = lineText(tokens).trimEnd();
    const x = round(codeX + indent * cw);
    const fullW = Math.max(cw, ((cols[i] ?? 0) - indent) * cw);
    const overflow = x + fullW > codeX + codeW;
    layers.push({
      id: `line-${i + 1}`,
      kind: "text",
      role: "code",
      parent: panel.id,
      box: { x, y, w: round(overflow ? codeX + codeW - x : fullW), h: lh },
      html: lineToHtml(tokens, theme),
      text,
      fontSize,
      reveal: "type",
      priority: TIER_CODE,
      style: monoStyle(theme.foreground),
      ...(overflow ? { clip: codeRect } : {}),
      ...(withGuide && indent === 0 ? { snaps: [guideId] } : {}),
      meta: { line: i + 1, indent },
    } satisfies TextLayer);
  }

  const blueprint: Blueprint = {
    version: 1,
    source: { type: "code", name: opts.fileName, title: opts.fileName, ...(opts.url ? { url: opts.url } : {}) },
    size: { w: W, h: H },
    background: theme.page,
    scheme: theme.scheme,
    icon: editorIcon(theme),
    layers,
  };
  if (shown < totalLines) {
    blueprint.truncated = { reason: `showing the first ${shown} of ${totalLines} lines`, dropped: totalLines - shown };
  }
  return {
    blueprint,
    metrics: {
      fontSize,
      lineHeight: lh,
      charWidth: cw,
      panel: panel.box,
      code: codeRect,
      shownLines: shown,
      totalLines,
    },
  };
}
