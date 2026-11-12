import { RuleIndex } from "../sheets";
import { bytesToDataUrl } from "./resources";

/** A font face created through the FontFace API in a watched window. */
export interface WatchedFace {
  family: string;
  /** `url(...)` list as given to the constructor, or the font bytes. */
  source: string | ArrayBuffer | ArrayBufferView;
  descriptors: FontFaceDescriptors;
}

/** Font faces created in a window while watched. */
export interface FontWatch {
  faces(): readonly WatchedFace[];
  /** Restores the window's `FontFace`. */
  stop(): void;
}

/**
 * Records every `new FontFace(...)` in `win` until `stop()`. A FontFace keeps no readable source,
 * and an SVG image cannot use the fonts of the page that draws it, so the rasterizer needs the
 * sources to embed the faces (KaTeX and other fonts adapters register through the API).
 */
export function watchFontFaces(win: Window & typeof globalThis): FontWatch {
  const original = win.FontFace;
  const faces: WatchedFace[] = [];
  if (typeof original !== "function") return { faces: () => faces, stop() {} };
  const watched = new Proxy(original, {
    construct(target, args: unknown[], newTarget) {
      const [family, source, descriptors] = args as [string, WatchedFace["source"], FontFaceDescriptors?];
      const face = Reflect.construct(target, args, newTarget) as FontFace;
      faces.push({ family: String(family), source, descriptors: { ...(descriptors ?? {}) } });
      return face;
    },
  });
  win.FontFace = watched;
  return {
    faces: () => faces,
    stop() {
      if (win.FontFace === watched) win.FontFace = original;
      faces.length = 0;
    },
  };
}

/** A CSS escape in a font family name, decoded as the browser reads it. */
function unescapeFamily(value: string): string {
  if (!value.includes("\\")) return value;
  return value.replace(
    /\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|([^\n\r\f0-9a-f]))|\\[\n\r\f]/gi,
    (_all, hex?: string, ch?: string) => {
      if (hex === undefined) return ch ?? "";
      const cp = Number.parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
    },
  );
}

/** A family name as font matching reads it: unquoted, unescaped and lower case. */
function familyName(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  const unquoted = (quote === '"' || quote === "'") && trimmed.at(-1) === quote ? trimmed.slice(1, -1) : trimmed;
  return unescapeFamily(unquoted).toLowerCase();
}

/** Every family in a CSS `font-family` list, lower case and unquoted; commas inside strings do not split it. */
export function familiesOf(value: string): string[] {
  const out: string[] = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i] as string;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === ",") {
      const family = familyName(value.slice(start, i));
      if (family) out.push(family);
      start = i + 1;
    }
  }
  const family = familyName(value.slice(start));
  if (family) out.push(family);
  return out;
}

/** Serialises a CSS string value (font family names) with double quotes. */
export function cssString(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\a ")}"`;
}

const DESCRIPTORS: readonly [keyof FontFaceDescriptors, string][] = [
  ["style", "font-style"],
  ["weight", "font-weight"],
  ["stretch", "font-stretch"],
  ["unicodeRange", "unicode-range"],
  ["featureSettings", "font-feature-settings"],
];

/**
 * An `@font-face` rule for a watched face whose source is already a CSS `src` list (with any
 * `url()` already embedded); binary sources are passed in as a data URL.
 */
export function fontFaceRule(face: WatchedFace, src: string): string {
  const parts = [`font-family:${cssString(face.family)}`, `src:${src}`, "font-display:block"];
  for (const [key, prop] of DESCRIPTORS) {
    const value = face.descriptors[key];
    if (typeof value === "string" && value) parts.push(`${prop}:${value}`);
  }
  return `@font-face{${parts.join(";")}}`;
}

/**
 * `@font-face` rules (CSSRule.FONT_FACE_RULE), at the top of a sheet or in grouping rules (`@media`,
 * `@supports`, `@layer`, `@container`); never in style rules (nesting takes none), `@page` (6) or
 * `@keyframes` (7).
 */
const FONT_FACE_RULES = new RuleIndex({
  keep: (type) => type === 5,
  enter: (type) => type !== 1 && type !== 6 && type !== 7,
});

/**
 * Every `@font-face` rule of a style sheet, including those nested in grouping rules. Called for
 * every frame, so the sheet is walked again only once its rules change ({@link RuleIndex}).
 */
export function fontFaceRules(sheet: CSSStyleSheet): readonly CSSFontFaceRule[] {
  return FONT_FACE_RULES.rules(sheet) as readonly CSSFontFaceRule[];
}

/** An `@font-face` rule ready for the snapshot sheet, and what it declares (duplicates share it). */
export interface FaceCss {
  key: string;
  /** The rule with its sources embedded, safe inside a CDATA section. */
  css: string;
}

/** Inclusive bounds of a descriptor value: a weight, a stretch in percent or code points. */
export type Span = readonly [number, number];

/** A face as font matching reads it (CSS Fonts 4 §5.2), and its rule once embedded. */
export interface FaceSource {
  /** Lower case and unquoted. */
  family: string;
  /** `italic` or `oblique` rather than `normal`. */
  slanted: boolean;
  weight: Span;
  stretch: Span;
  /** Its `unicode-range`, null when it covers every code point. */
  chars: readonly Span[] | null;
  /** The rule with its sources embedded, read and fetched on first use. */
  css(): Promise<FaceCss>;
}

/** What a frame draws text with. */
export interface FontUsage {
  /** Per family (lower case), the faces asked for: computed `font-style|font-weight|font-stretch`. */
  faces: ReadonlyMap<string, ReadonlySet<string>>;
  /** Code points the frame may show beyond {@link ALWAYS_SHOWN}, ascending; read only when needed. */
  chars(): readonly number[];
}

/** A `url("...")` as the CSSOM serialises it; group 1 is the URL with its escapes. */
const CSS_URL = /url\("((?:[^"\\]|\\.)*)"\)/g;
/** A `url()` as a FontFace source string may give it; group 2 is the URL. */
const SOURCE_URL = /url\((['"]?)([^'")]+)\1\)/g;
/** The sources of an `src` list that pick the font (format and tech hints left out). */
const SOURCE_ITEM = /url\("(?:[^"\\]|\\.)*"\)|local\([^)]*\)/g;
const WEIGHTS: Readonly<Record<string, number>> = { normal: 400, bold: 700 };
const STRETCHES: Readonly<Record<string, number>> = {
  "ultra-condensed": 50,
  "extra-condensed": 62.5,
  condensed: 75,
  "semi-condensed": 87.5,
  normal: 100,
  "semi-expanded": 112.5,
  expanded: 125,
  "extra-expanded": 150,
  "ultra-expanded": 200,
};
/**
 * Code points a frame may show without them being in its markup (generated quotes, list markers,
 * ellipses, hyphens, masked inputs): Latin-1, general punctuation, arrows, geometric shapes and CJK
 * punctuation. A face covering any of them is always kept.
 */
const ALWAYS_SHOWN: readonly Span[] = [
  [0x0, 0xff],
  [0x2000, 0x206f],
  [0x2190, 0x21ff],
  [0x25a0, 0x25ff],
  [0x3000, 0x303f],
];

/** Descriptor values as the face matching sees them: CSS defaults spelled one way. */
function normal(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim().toLowerCase();
  if (!v || v === "400" || v === "100%") return fallback;
  return v === "700" ? "bold" : v;
}

/**
 * A `font-weight` or `font-stretch` value (one value, or a range for a variable font) as a span;
 * `fallback` when it is absent or not understood, as the browser drops an invalid descriptor.
 */
function spanOf(value: string | undefined, keywords: Readonly<Record<string, number>>, fallback: number): Span {
  const parts = (value ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts[0] === "auto") return [0, Number.POSITIVE_INFINITY];
  const values = parts.map((part) => keywords[part] ?? Number.parseFloat(part));
  const [lo, hi = lo] = values;
  if (lo === undefined || values.length > 2 || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return [fallback, fallback];
  }
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/** A `unicode-range` value as spans, null when absent or not understood (every code point). */
function unicodeSpans(value: string | undefined): Span[] | null {
  if (!value?.trim()) return null;
  const spans: Span[] = [];
  for (const part of value.split(",")) {
    const m = /^\s*u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(part);
    if (!m?.[1]) return null;
    const lo = Number.parseInt(m[1].replace(/\?/g, "0"), 16);
    const hi = Number.parseInt(m[2] ?? m[1].replace(/\?/g, "f"), 16);
    spans.push([lo, hi]);
  }
  return spans;
}

/**
 * Faces whose span holds `want`, else those nearest below and above it. Font matching picks one
 * of these (which one depends on the descriptor and the value); keeping both is never wrong.
 */
function nearest(faces: readonly FaceSource[], span: (face: FaceSource) => Span, want: number): FaceSource[] {
  const inside = faces.filter((face) => span(face)[0] <= want && want <= span(face)[1]);
  if (inside.length > 0) return inside;
  let below = Number.NEGATIVE_INFINITY;
  let above = Number.POSITIVE_INFINITY;
  for (const face of faces) {
    const [lo, hi] = span(face);
    if (hi < want) below = Math.max(below, hi);
    else if (lo > want) above = Math.min(above, lo);
  }
  return faces.filter((face) => span(face)[1] === below || span(face)[0] === above);
}

/** The faces of one family font matching may pick for `want` (`style|weight|stretch`): stretch, then style, then weight. */
function matching(faces: readonly FaceSource[], want: string): FaceSource[] {
  const [style = "", weight = "", stretch = ""] = want.split("|");
  const slanted = /^(italic|oblique)/.test(style);
  const byStretch = new Map<string, FaceSource[]>();
  for (const face of nearest(faces, (f) => f.stretch, spanOf(stretch, STRETCHES, 100)[0])) {
    const key = face.stretch.join(" ");
    byStretch.set(key, [...(byStretch.get(key) ?? []), face]);
  }
  const out: FaceSource[] = [];
  for (const group of byStretch.values()) {
    const styled = group.filter((face) => face.slanted === slanted);
    out.push(...nearest(styled.length > 0 ? styled : group, (f) => f.weight, spanOf(weight, WEIGHTS, 400)[0]));
  }
  return out;
}

/** Whether ascending `chars` hold one in `span`. */
function holds(chars: readonly number[], [lo, hi]: Span): boolean {
  let a = 0;
  let b = chars.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if ((chars[mid] as number) < lo) a = mid + 1;
    else b = mid;
  }
  return a < chars.length && (chars[a] as number) <= hi;
}

/**
 * The faces, in order, the frame's text may be drawn in: per family, those font matching may pick
 * for a face asked for, and of those the ones whose `unicode-range` holds a code point the frame
 * may show. The browser loads no other face, and an image that embeds them pays for every byte on
 * every frame. Text a page never writes (a counter in a script it does not use) may show in a
 * fallback font.
 */
export function pickFaces(faces: readonly FaceSource[], usage: FontUsage): FaceSource[] {
  const byFamily = new Map<string, FaceSource[]>();
  for (const face of faces) byFamily.set(face.family, [...(byFamily.get(face.family) ?? []), face]);
  const kept = new Set<FaceSource>();
  for (const [family, list] of byFamily) {
    for (const want of usage.faces.get(family) ?? []) for (const face of matching(list, want)) kept.add(face);
  }
  let chars: readonly number[] | null = null;
  const shows = (span: Span) => {
    if (ALWAYS_SHOWN.some(([lo, hi]) => span[0] <= hi && lo <= span[1])) return true;
    chars ??= usage.chars();
    return holds(chars, span);
  };
  return faces.filter((face) => kept.has(face) && (face.chars === null || face.chars.some(shows)));
}

/**
 * What a face declares: family, the descriptors font matching reads, how it is displayed, and its
 * sources once embedded. Two faces with the same key draw the same glyphs, whether they come from
 * a style sheet or the FontFace API.
 */
function faceKey(family: string, d: Record<string, string | undefined>, css: string): string {
  const sources = Array.from(css.matchAll(SOURCE_ITEM), ([item]) =>
    item.startsWith("local(") ? item.replace(/["'\s]/g, "").toLowerCase() : item,
  );
  return [
    familyName(family),
    normal(d.style, "normal"),
    normal(d.weight, "normal"),
    normal(d.stretch, "normal"),
    (d.unicodeRange ?? "").replace(/\s/g, "").toUpperCase(),
    normal(d.featureSettings, "normal"),
    normal(d.display, "auto"),
    d.overrides ?? "",
    ...sources,
  ].join("\n");
}

/** Keeps CSS inside a CDATA section: `]]>` is closed and reopened around its `>`. */
function cdataSafe(css: string): string {
  return css.replace(/]]>/g, "]]]]><![CDATA[>");
}

/** A function that runs `read` once, on its first call. */
function once<T>(read: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | null = null;
  return () => {
    result ??= read();
    return result;
  };
}

/**
 * The `@font-face` rules of an export, each read and embedded once rather than for every frame: a
 * face embeds its whole font, often megabytes, and the rules do not change during an export. A
 * rule edited in place through the CSSOM keeps what it declared when first read; a new or replaced
 * style sheet is read again.
 */
export class FontFaceCache {
  readonly #resolve: (url: string) => Promise<string>;
  readonly #rules = new WeakMap<CSSFontFaceRule, FaceSource>();
  readonly #faces = new WeakMap<WatchedFace, FaceSource>();
  #last: { faces: readonly FaceCss[]; css: string } = { faces: [], css: "" };

  /** `resolve` turns a font URL into a data URL (it never rejects). */
  constructor(resolve: (url: string) => Promise<string>) {
    this.#resolve = resolve;
  }

  /** A style sheet rule; its `url()`s are embedded on first use (data URLs are kept as they are). */
  rule(rule: CSSFontFaceRule): FaceSource {
    let face = this.#rules.get(rule);
    if (!face) {
      const value = (name: string) => rule.style.getPropertyValue(name);
      face = {
        family: familyName(value("font-family")),
        slanted: /^(italic|oblique)/i.test(value("font-style").trim()),
        weight: spanOf(value("font-weight"), WEIGHTS, 400),
        stretch: spanOf(value("font-stretch"), STRETCHES, 100),
        chars: unicodeSpans(value("unicode-range")),
        css: once(() => this.#readRule(rule)),
      };
      this.#rules.set(rule, face);
    }
    return face;
  }

  /** A face created through the FontFace API, as a rule; binary sources become a data URL. */
  face(watched: WatchedFace): FaceSource {
    let face = this.#faces.get(watched);
    if (!face) {
      const d = watched.descriptors;
      face = {
        family: familyName(watched.family),
        slanted: /^(italic|oblique)/i.test((d.style ?? "").trim()),
        weight: spanOf(d.weight, WEIGHTS, 400),
        stretch: spanOf(d.stretch, STRETCHES, 100),
        chars: unicodeSpans(d.unicodeRange),
        css: once(() => this.#readFace(watched)),
      };
      this.#faces.set(watched, face);
    }
    return face;
  }

  /**
   * The rules of the faces `usage` may draw with ({@link pickFaces}), in order, a face declared
   * again left out where it first appears (the later one is matched first, as on the page). The
   * same string object while those faces stay the same, so whoever encodes it can keep the result.
   */
  async block(faces: readonly FaceSource[], usage: FontUsage): Promise<string> {
    const byKey = new Map<string, FaceCss>();
    for (const face of await Promise.all(pickFaces(faces, usage).map((f) => f.css()))) {
      byKey.delete(face.key);
      byKey.set(face.key, face);
    }
    const kept = Array.from(byKey.values());
    const last = this.#last;
    if (kept.length === last.faces.length && kept.every((face, i) => face === last.faces[i])) return last.css;
    this.#last = { faces: kept, css: kept.map((face) => face.css).join("\n") };
    return this.#last.css;
  }

  async #readRule(rule: CSSFontFaceRule): Promise<FaceCss> {
    const text = rule.cssText;
    const embeds = (raw: string) => raw !== "" && !raw.startsWith("data:") && !raw.startsWith("#");
    const urls = Array.from(text.matchAll(CSS_URL), (m) => m[1] ?? "").filter(embeds);
    const data = await Promise.all(urls.map((raw) => this.#resolve(raw.replace(/\\(.)/g, "$1"))));
    let next = 0;
    const css =
      urls.length === 0
        ? text
        : text.replace(CSS_URL, (match, raw: string) =>
            embeds(raw) ? `url(${cssString(data[next++] ?? "")})` : match,
          );
    const value = (name: string) => rule.style.getPropertyValue(name);
    const overrides = ["size-adjust", "ascent-override", "descent-override", "line-gap-override"].map(value).join(";");
    const key = faceKey(
      value("font-family"),
      {
        style: value("font-style"),
        weight: value("font-weight"),
        stretch: value("font-stretch"),
        unicodeRange: value("unicode-range"),
        featureSettings: value("font-feature-settings"),
        display: value("font-display"),
        overrides: overrides === ";;;" ? "" : overrides,
      },
      css,
    );
    return { key, css: cdataSafe(css) };
  }

  async #readFace(face: WatchedFace): Promise<FaceCss> {
    let src: string;
    if (typeof face.source === "string") {
      const embeds = (url: string) => !url.startsWith("data:") && !url.startsWith("#");
      const urls = Array.from(face.source.matchAll(SOURCE_URL), (m) => m[2] ?? "").filter(embeds);
      const data = await Promise.all(urls.map((url) => this.#resolve(url)));
      let next = 0;
      src = face.source.replace(SOURCE_URL, (match, _q, url: string) =>
        url.startsWith("#") ? match : `url(${cssString(embeds(url) ? (data[next++] ?? "") : url)})`,
      );
    } else {
      src = `url(${cssString(await bytesToDataUrl(face.source, "font/ttf"))})`;
    }
    const d = face.descriptors;
    const key = faceKey(
      face.family,
      {
        style: d.style,
        weight: d.weight,
        stretch: d.stretch,
        unicodeRange: d.unicodeRange,
        featureSettings: d.featureSettings,
        display: "block",
      },
      src,
    );
    return { key, css: cdataSafe(fontFaceRule(face, src)) };
  }
}
