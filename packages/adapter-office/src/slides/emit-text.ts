/**
 * Text bodies -> TextLayer content: a sanitized HTML fragment built only from escaped text and
 * our own inline styles, plus the plain text the typing choreography reveals.
 */

import type { CSSMap } from "@swarmloom/core";
import { cssColor } from "../shared/color";
import { escapeHtml, px, round2, styleAttr } from "../shared/html";
import type { RunStyle, Spacing, TextBody, TextParagraph } from "./model";

/** PowerPoint's single line spacing is about 1.2 times the font size. */
const SINGLE_LINE = 1.2;

export interface TextContent {
  html: string;
  /** Equals the text content of `html` (bullets included), in order. */
  text: string;
  style: CSSMap;
  /** Largest run size, px. */
  fontSize: number;
}

const JUSTIFY: Readonly<Record<TextBody["anchor"], string>> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

class TextWriter {
  html = "";
  text = "";
  maxSize = 0;

  constructor(
    /** px per point at this zoom, including normAutofit scaling. */
    private readonly pt: number,
    /** px per EMU. */
    private readonly k: number,
    private readonly lineReduction: number,
  ) {}

  size(style: RunStyle): number {
    return style.sizePt * this.pt;
  }

  runCss(style: RunStyle, scale = 1): CSSMap {
    const size = this.size(style) * scale;
    const css: CSSMap = {
      "font-size": px(style.baseline ? size * 0.66 : size),
      "font-family": style.font,
      color: cssColor(style.color),
    };
    if (style.bold) css["font-weight"] = "700";
    if (style.italic) css["font-style"] = "italic";
    const deco = [style.underline ? "underline" : "", style.strike ? "line-through" : ""].filter(Boolean).join(" ");
    if (deco) css["text-decoration"] = deco;
    if (style.baseline) css["vertical-align"] = style.baseline > 0 ? "super" : "sub";
    if (style.caps === "all") css["text-transform"] = "uppercase";
    if (style.caps === "small") css["font-variant"] = "small-caps";
    if (style.highlight) css["background-color"] = cssColor(style.highlight);
    return css;
  }

  spacing(s: Spacing, fontPx: number): string {
    return "pct" in s ? px(s.pct * SINGLE_LINE * fontPx) : px(s.pts * this.pt);
  }

  lineHeight(s: Spacing): string {
    if ("pts" in s) return px(s.pts * this.pt);
    return String(round2(Math.max(0.5, s.pct - this.lineReduction) * SINGLE_LINE));
  }

  paragraph(p: TextParagraph): void {
    const first = p.runs.find((r) => "text" in r)?.style ?? p.endStyle;
    const fontPx = this.size(first);
    const css: CSSMap = {
      margin: "0",
      "text-align": p.align,
      "font-size": px(fontPx),
      "line-height": this.lineHeight(p.lineSpacing),
    };
    if (p.marL) css["padding-left"] = px(p.marL * this.k);
    if (p.indent) css["text-indent"] = px(p.indent * this.k);
    const before = this.spacing(p.spaceBefore, fontPx);
    const after = this.spacing(p.spaceAfter, fontPx);
    if (before !== "0px") css["margin-top"] = before;
    if (after !== "0px") css["margin-bottom"] = after;
    if (p.rtl) css.direction = "rtl";
    this.html += `<p style="${styleAttr(css)}">`;

    if (p.bullet) {
      const b = p.bullet;
      const bulletCss: CSSMap = {
        ...this.runCss({ ...first, font: b.font, color: b.color, bold: false, italic: false }, b.scale),
        display: "inline-block",
        "text-indent": "0",
        "text-decoration": "none",
      };
      if (p.indent < 0) bulletCss["min-width"] = px(-p.indent * this.k);
      else bulletCss["margin-right"] = "0.4em";
      this.html += `<span style="${styleAttr(bulletCss)}">${escapeHtml(b.text)}</span>`;
      this.text += b.text;
    }

    let pending = "";
    let pendingCss = "";
    const flush = () => {
      if (pending) this.html += `<span style="${pendingCss}">${escapeHtml(pending)}</span>`;
      pending = "";
    };
    for (const run of p.runs) {
      if ("br" in run) {
        flush();
        this.html += "<br>";
        continue;
      }
      this.maxSize = Math.max(this.maxSize, this.size(run.style));
      const runCss = styleAttr(this.runCss(run.style));
      if (runCss !== pendingCss) flush();
      pendingCss = runCss;
      pending += run.text;
      this.text += run.text;
    }
    flush();
    if (!p.runs.some((r) => "text" in r)) this.html += "<br>";
    this.html += "</p>";
  }
}

/**
 * Builds TextLayer content for a text body.
 *
 * @param body Parsed text body.
 * @param k Pixels per EMU at the current zoom.
 */
export function textContent(body: TextBody, k: number): TextContent {
  // 1pt = 12700 EMU.
  const pt = 12700 * k * body.fontScale;
  const writer = new TextWriter(pt, k, body.lineReduction);
  for (const p of body.paragraphs) writer.paragraph(p);
  const first = body.paragraphs.flatMap((p) => p.runs).find((r) => "text" in r)?.style;
  const ins = body.insets;
  const style: CSSMap = {
    "box-sizing": "border-box",
    padding: `${px(ins.t * k)} ${px(ins.r * k)} ${px(ins.b * k)} ${px(ins.l * k)}`,
    display: "flex",
    "flex-direction": "column",
    "justify-content": JUSTIFY[body.anchor],
    "white-space": body.wrap ? "pre-wrap" : "pre",
    "overflow-wrap": "break-word",
    "line-height": String(SINGLE_LINE),
  };
  if (first) {
    style["font-family"] = first.font;
    style.color = cssColor(first.color);
    style["font-size"] = px(first.sizePt * pt);
  }
  if (body.vertical) style["writing-mode"] = body.vertical;
  return { html: writer.html, text: writer.text, style, fontSize: round2(writer.maxSize) };
}
