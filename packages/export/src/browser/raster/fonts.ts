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

/** First family of a CSS `font-family` value, lower case and unquoted, plus the rest: every family named. */
export function familiesOf(value: string): string[] {
  return value
    .split(",")
    .map((f) =>
      f
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean);
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

/** Every `@font-face` rule of a style sheet, including those nested in grouping rules. */
export function fontFaceRules(sheet: CSSStyleSheet): CSSFontFaceRule[] {
  const out: CSSFontFaceRule[] = [];
  const visit = (rules: CSSRuleList | undefined): void => {
    if (!rules) return;
    for (const rule of Array.from(rules)) {
      // CSSRule.FONT_FACE_RULE; constructor checks would fail across windows.
      if (rule.type === 5) out.push(rule as CSSFontFaceRule);
      else if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  try {
    visit(sheet.cssRules);
  } catch {
    // Cross-origin sheets keep their rules private.
  }
  return out;
}
