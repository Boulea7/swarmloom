import type { CSSMap } from "@swarmloom/core";

/** CSS pixels per unit, at the CSS reference resolution of 96 px per inch. */
const PX_PER: Record<string, number> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
  pc: 16,
  twip: 96 / 1440,
};

/** Millimetres to CSS pixels. */
export const MM = PX_PER.mm as number;

/**
 * Parses an absolute length such as `2.5cm`, `12pt`, `0.4in` or `10px` into CSS pixels.
 * Unitless numbers use `defaultUnit`. Relative units and garbage return `undefined`.
 */
export function lengthPx(
  value: string | null | undefined,
  defaultUnit: keyof typeof PX_PER = "px",
): number | undefined {
  if (!value) return undefined;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|pt|pc)?\s*$/i.exec(value);
  if (!m) return undefined;
  const n = Number(m[1]);
  const factor = PX_PER[(m[2] ?? defaultUnit).toLowerCase()];
  return Number.isFinite(n) && factor !== undefined ? n * factor : undefined;
}

/** Parses `80%` into 0.8, or `undefined`. */
export function percent(value: string | null | undefined): number | undefined {
  const m = value ? /^\s*([+-]?(?:\d+\.?\d*|\.\d+))%\s*$/.exec(value) : null;
  return m ? Number(m[1]) / 100 : undefined;
}

/** Formats a pixel value for CSS with at most two decimals: 12.3456 -> "12.35px". */
export function px(n: number): string {
  const r = Math.round(n * 100) / 100;
  return `${Object.is(r, -0) ? 0 : r}px`;
}

const NAMED_COLOR = /^[a-z]{3,24}$/i;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.%\s,/+-]+\)$/i;

/** Returns `value` when it is a plain CSS colour (hex, rgb()/hsl(), or a keyword), else `undefined`. */
export function cssColor(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return HEX_COLOR.test(v) || FUNC_COLOR.test(v) || NAMED_COLOR.test(v) ? v : undefined;
}

/** `rgb(r, g, b)` from 0..255 components, clamped. */
export function rgb(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

/** Returns `value` when it is one of `allowed` (case-insensitive), else `undefined`. */
export function keyword<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | undefined {
  const v = value?.trim().toLowerCase();
  return allowed.find((a) => a === v);
}

/** Serialises declarations into an inline style string, skipping empty values. */
export function styleText(css: CSSMap): string {
  let out = "";
  for (const [k, v] of Object.entries(css)) if (v !== "") out += `${k}:${v};`;
  return out;
}
