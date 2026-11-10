/** Text measurement helpers: grapheme units for typing and font metrics from layer styles. */

import type { TextLayer } from "../types";

const DEFAULT_FONT_PX = 16;
const NORMAL_LINE_HEIGHT = 1.2;
const WHITESPACE = /^\s+$/u;
/** HTML (ASCII) whitespace, the class the stage merges into one typing unit ("\r\n" is one grapheme). */
const HTML_WHITESPACE = /^[ \t\n\r\f]+$/;
const LINE_BREAK = /[\n\r\u2028\u2029]/u;
/** Clause-ending punctuation (Latin and CJK); a beat follows it and thinking pauses happen after it. */
const CLAUSE_END = /^[,.;:!?\u2026\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F]$/u;

let segmenter: Intl.Segmenter | null | undefined;

function graphemeSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    // Grapheme rules (UAX #29) do not depend on the locale; a fixed one keeps exports stable.
    segmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
  }
  return segmenter;
}

/**
 * Splits text into user-perceived characters, so emoji, ZWJ sequences and combining marks
 * appear in one keystroke. Falls back to code points where `Intl.Segmenter` is missing.
 */
export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  const seg = graphemeSegmenter();
  if (!seg) return Array.from(text);
  const out: string[] = [];
  for (const part of seg.segment(text)) out.push(part.segment);
  return out;
}

/**
 * Typing units of a text: graphemes, with every run of HTML whitespace (space, tab, line feed,
 * carriage return, form feed) merged into one unit. This is the unit the stage counts for
 * `reveal` fractions and `caretAt` indices, so a layer's own source indentation never costs
 * keystrokes and the caret lands where the stage draws the typed text. Other spaces (no-break,
 * ideographic) stay separate units, as they do on the stage.
 */
export function typingUnits(text: string): string[] {
  const out: string[] = [];
  let run = "";
  for (const unit of splitGraphemes(text)) {
    if (HTML_WHITESPACE.test(unit)) {
      run += unit;
      continue;
    }
    if (run) out.push(run);
    run = "";
    out.push(unit);
  }
  if (run) out.push(run);
  return out;
}

export function isWhitespace(unit: string | undefined): boolean {
  return unit !== undefined && WHITESPACE.test(unit);
}

export function isLineBreak(unit: string | undefined): boolean {
  return unit !== undefined && LINE_BREAK.test(unit);
}

export function isClauseEnd(unit: string | undefined): boolean {
  return unit !== undefined && CLAUSE_END.test(unit);
}

export interface FontMetrics {
  fontSize: number;
  lineHeight: number;
}

/** Parses a CSS length in px, em, rem (16 px), % (of `fontSize`) or a unitless factor of `fontSize`. */
function parseLength(value: string | undefined, fontSize: number, unitless: "px" | "factor"): number | undefined {
  if (!value) return undefined;
  const match = /^\s*(-?\d*\.?\d+)\s*(px|em|rem|%)?\s*$/i.exec(value);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  switch (match[2]?.toLowerCase()) {
    case "px":
      return n;
    case "em":
      return n * fontSize;
    case "rem":
      return n * DEFAULT_FONT_PX;
    case "%":
      return (n / 100) * fontSize;
    default:
      return unitless === "px" ? n : n * fontSize;
  }
}

/** Font size and line height of a text layer, with safe defaults for missing or invalid styles. */
export function textMetrics(layer: TextLayer): FontMetrics {
  const style = layer.style ?? {};
  const declared = layer.fontSize;
  const fontSize =
    typeof declared === "number" && Number.isFinite(declared) && declared > 0
      ? declared
      : (parseLength(style["font-size"], DEFAULT_FONT_PX, "px") ?? DEFAULT_FONT_PX);
  const lineHeight = parseLength(style["line-height"], fontSize, "factor") ?? fontSize * NORMAL_LINE_HEIGHT;
  return { fontSize, lineHeight };
}

/** Metrics of the same text at another font size (line height scales along). */
export function scaleMetrics(m: FontMetrics, fontSize: number): FontMetrics {
  return { fontSize, lineHeight: m.lineHeight * (fontSize / m.fontSize) };
}
