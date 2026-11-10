import { fontStack } from "@swarmloom/adapter-docx/paged";
import type { CharProps, DocFont, ParaProps } from "../model";
import { halfPoints, px, twipsToPx } from "./units";

/** Word's "single" line spacing is roughly 1.15 times the font size for common fonts. */
const SINGLE_LINE = 1.15;

/** Resolves font-table indexes to CSS stacks, cached per (ascii, east-asian) pair. */
export class FontResolver {
  private readonly cache = new Map<string, string>();

  constructor(private readonly fonts: readonly DocFont[]) {}

  stack(props: CharProps): string {
    const key = `${props.font}:${props.fontEastAsia}`;
    let stack = this.cache.get(key);
    if (!stack) {
      const ascii = this.fonts[props.font];
      const eastAsia = this.fonts[props.fontEastAsia];
      const families = fontStack(ascii?.name || "Times New Roman", ascii?.generic ?? null).split(", ");
      if (eastAsia?.name && eastAsia.name !== ascii?.name) {
        families.splice(1, 0, fontStack(eastAsia.name, eastAsia.generic).split(", ")[0]);
      }
      stack = [...new Set(families)].join(", ");
      this.cache.set(key, stack);
    }
    return stack;
  }
}

function decoration(p: CharProps): string {
  const lines = [p.underline ? "underline" : "", p.strike ? "line-through" : ""].filter(Boolean);
  return lines.length > 0 ? lines.join(" ") : "none";
}

/** All character declarations, used for the paragraph element (the base the runs differ from). */
export function charCss(p: CharProps, fonts: FontResolver): Record<string, string> {
  return {
    "font-family": fonts.stack(p),
    "font-size": halfPoints(p.size),
    "font-weight": p.bold ? "700" : "400",
    "font-style": p.italic ? "italic" : "normal",
    "text-decoration": decoration(p),
    "text-transform": p.caps ? "uppercase" : "none",
    "font-variant": p.smallCaps ? "small-caps" : "normal",
    color: p.color ?? "#000000",
    "background-color": p.highlight ?? "transparent",
  };
}

/** Only the declarations of `run` that differ from `base`. */
export function charCssDiff(run: CharProps, base: CharProps, fonts: FontResolver): Record<string, string> {
  const a = charCss(run, fonts);
  const b = charCss(base, fonts);
  const out: Record<string, string> = {};
  for (const key of Object.keys(a)) if (a[key] !== b[key]) out[key] = a[key];
  return out;
}

function lineHeight(p: ParaProps): string {
  if (!p.line || p.line.value === 0) return String(SINGLE_LINE);
  if (p.line.multiple) return String(Math.round((p.line.value / 240) * SINGLE_LINE * 1000) / 1000);
  // Positive: at least; negative: exactly. Both become a fixed line box here.
  return `${Math.abs(p.line.value) / 20}pt`;
}

/** Block-level declarations of a paragraph. Vertical spacing is passed in because it depends on neighbours. */
export function paraCss(p: ParaProps, spacing: { top: number; bottom: number }): Record<string, string> {
  const css: Record<string, string> = {
    "text-align": p.align,
    "line-height": lineHeight(p),
  };
  if (spacing.top) css["margin-top"] = `${spacing.top / 20}pt`;
  if (spacing.bottom) css["margin-bottom"] = `${spacing.bottom / 20}pt`;
  if (p.indentLeft) css["padding-left"] = px(twipsToPx(p.indentLeft));
  if (p.indentRight) css["padding-right"] = px(twipsToPx(p.indentRight));
  if (p.indentFirst) css["text-indent"] = px(twipsToPx(p.indentFirst));
  if (p.shading) css["background-color"] = p.shading;
  return css;
}

/** Serializes declarations for a `style` attribute. Values come from parsed numbers and fixed tables only. */
export function styleText(css: Record<string, string>): string {
  return Object.entries(css)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
