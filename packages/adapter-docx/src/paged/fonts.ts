import { formatFontFamily, type GenericFontFamily, resolveFontFamily } from "@swarmloom/core";

/** CSS generic family used as the last resort of a stack (the core type, re-exported for DOC). */
export type GenericFamily = GenericFontFamily;

const GENERICS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "inherit", "initial"]);

/**
 * A CSS font-family stack for an Office font name, from the shared core table (decisions-v1 F01):
 * the font itself, other names of it, its open substitute, look-alikes, CJK fallbacks and a generic
 * family. `generic` is the document's own hint for fonts the table does not know.
 */
export function fontStack(name: string, generic?: GenericFamily | null): string {
  return resolveFontFamily(name, generic ?? undefined).family;
}

function unquote(name: string): string {
  return name
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .trim();
}

/**
 * Appends fallbacks to an existing font-family list (as written by a renderer), based on its first
 * concrete family. Lists that already end in a generic family are left alone, and so are lists that
 * use var(): the variables get their fallbacks where they are defined (`rewriteFontFamilies`), and an
 * undefined variable would invalidate the whole declaration anyway.
 */
export function withFontFallbacks(list: string): string {
  const families = splitFamilies(list);
  if (families.length === 0) return list;
  const last = unquote(families[families.length - 1]).toLowerCase();
  if (GENERICS.has(last) || families.some((f) => f.includes("var("))) return list;
  const first = families.map(unquote).find((f) => f !== "");
  const stack = fontStack(first ?? "Calibri")
    .split(", ")
    .slice(first ? 1 : 0);
  return [...families.map((f) => f.trim()), ...stack].join(", ");
}

/** Splits a font-family value at top-level commas (commas inside quotes or var() are kept). */
function splitFamilies(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoteChar = "";
  let current = "";
  for (const ch of list) {
    if (quoteChar) {
      if (ch === quoteChar) quoteChar = "";
    } else if (ch === '"' || ch === "'") {
      quoteChar = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Rewrites every `font-family` declaration and `--*-font` theme variable in a style sheet so that
 * missing Office fonts degrade to look-alikes instead of the browser default.
 */
export function rewriteFontFamilies(css: string): string {
  return css
    .replace(
      /(font-family\s*:\s*)([^;}!]+)/gi,
      (_m, prop: string, value: string) => `${prop}${withFontFallbacks(value)}`,
    )
    .replace(
      /(--[\w-]*font\s*:\s*)([^;}!]+)/gi,
      (_m, prop: string, value: string) => `${prop}${withFontFallbacks(value)}`,
    );
}

/** Text that differs between most Latin, CJK and Hangul fonts and the generic families. */
const PROBE = "mmmmmmmmmmlli1WQ@\u6c38\u56fd\u3042\ud55c";
const PROBE_BASES = ["monospace", "serif", "sans-serif"] as const;
const MAX_PROBED = 32;

/**
 * The families in `names` that are not available to `doc` (neither installed nor loaded), found by
 * comparing text widths against the generic families on a canvas. Returns [] when canvas text metrics
 * are unavailable (e.g. non-browser environments), so callers only ever under-report.
 */
export function missingFonts(doc: Document, names: Iterable<string>): string[] {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = doc.createElement("canvas").getContext("2d");
  } catch {
    return [];
  }
  if (!ctx || typeof ctx.measureText !== "function") return [];
  const context = ctx;
  const width = (font: string): number => {
    context.font = `40px ${font}`;
    return context.measureText(PROBE).width;
  };
  const bases = PROBE_BASES.map((generic) => [generic, width(generic)] as const);
  if (bases.every(([, w]) => w === 0)) return [];
  const out: string[] = [];
  for (const name of [...new Set(names)].slice(0, MAX_PROBED)) {
    if (bases.every(([generic, w]) => width(formatFontFamily([name], generic)) === w)) out.push(name);
  }
  return out;
}

/**
 * What a missing font is replaced with: its open substitute from the shared core table (F01), else a
 * description of its generic family ("a serif font").
 */
export function substituteFor(name: string): string {
  const { family, substituted } = resolveFontFamily(name);
  return substituted ?? `a ${family.slice(family.lastIndexOf(", ") + 2)} font`;
}

const MAX_LISTED = 6;

/**
 * A quality note naming the fonts of `families` that `doc` lacks and their look-alikes (decisions-v1
 * F01), or null when every font is available or availability cannot be measured.
 */
export function fontSubstitutionNote(doc: Document, families: Iterable<string>): string | null {
  const missing = missingFonts(doc, families);
  if (missing.length === 0) return null;
  const listed = missing.slice(0, MAX_LISTED).map((name) => `${name} \u2192 ${substituteFor(name)}`);
  const more = missing.length > MAX_LISTED ? ` and ${missing.length - MAX_LISTED} more` : "";
  return `Fonts not installed on this device are shown with look-alikes (or the closest installed font): ${listed.join(", ")}${more}.`;
}

/**
 * The first concrete family of every font-family list in `css` (declarations and `--*-font` theme
 * variables), skipping generic families and var() references. Used to probe for missing fonts.
 */
export function primaryFamilies(css: string): string[] {
  const out = new Set<string>();
  const lists = css.matchAll(/(?:font-family|--[\w-]*font)\s*:\s*([^;}!]+)/gi);
  for (const match of lists) {
    const first = splitFamilies(match[1] ?? "")
      .map(unquote)
      .find((f) => f !== "" && !f.startsWith("var("));
    if (first && !GENERICS.has(first.toLowerCase())) out.add(first);
  }
  return [...out];
}
