/** Parses a CSS length in px (`"12.5px"` -> 12.5). Non-numeric values give `fallback`. */
export function px(value: string | null | undefined, fallback = 0): number {
  if (!value) return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Splits a CSS value on a separator at the top level, ignoring separators inside
 * parentheses and quoted strings: `"url(a,b), linear-gradient(red, blue)"` -> 2 parts.
 */
export function splitTopLevel(value: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] as string;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last || out.length > 0) out.push(last);
  return out;
}

const URL_TOKEN = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/gi;

function unescapeCss(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/** Every `url(...)` reference in a CSS value, unescaped. */
export function extractUrls(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(URL_TOKEN)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    out.push(unescapeCss(raw));
  }
  return out;
}

/** Quotes a string for use inside CSS `url("...")` or `content: "..."`. */
export function cssString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
}

/**
 * Rewrites every `url(...)` in a CSS value. `map` returns the new URL, or null to drop the
 * reference (replaced by `none`, which is valid wherever an image is expected).
 */
export function rewriteUrls(value: string, map: (url: string) => string | null): string {
  return value.replace(URL_TOKEN, (_all, dq?: string, sq?: string, bare?: string) => {
    const next = map(unescapeCss(dq ?? sq ?? bare ?? ""));
    return next === null ? "none" : `url(${cssString(next)})`;
  });
}

/** Lower-cased, unquoted family names of a `font-family` list. */
export function fontFamilies(value: string): string[] {
  return splitTopLevel(value)
    .map((f) =>
      f
        .replace(/^["']|["']$/g, "")
        .trim()
        .toLowerCase(),
    )
    .filter((f) => f.length > 0);
}
