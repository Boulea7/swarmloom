/** Colour and font style of one token class. */
export interface TokenStyle {
  color?: string;
  italic?: boolean;
  bold?: boolean;
}

/**
 * An editor colour theme. Token keys are highlight.js scopes with the `hljs-` prefix removed and
 * sub-scopes joined by dots ("title.function", "variable.language"). Lookup falls back from the
 * most specific key to its prefix ("title.function" -> "title").
 */
export interface CodeTheme {
  name: string;
  scheme: "light" | "dark";
  /** Page behind the editor panel. */
  page: string;
  /** Editor panel and code background. */
  background: string;
  foreground: string;
  border: string;
  shadow: string;
  titleBar: string;
  titleText: string;
  muted: string;
  gutter: string;
  gutterText: string;
  indentGuide: string;
  tokens: Readonly<Record<string, TokenStyle>>;
}

/** "Loom Day": original light theme built around the SwarmLoom indigo. Token colours keep 4.5:1 on the background. */
export const LOOM_DAY: CodeTheme = {
  name: "loom-day",
  scheme: "light",
  page: "#EEF0F7",
  background: "#FCFCFE",
  foreground: "#23233A",
  border: "rgba(11, 11, 18, 0.10)",
  shadow: "0 1px 2px rgba(11, 11, 18, 0.06), 0 18px 48px -12px rgba(43, 43, 120, 0.22)",
  titleBar: "#F3F4FA",
  titleText: "#23233A",
  muted: "#64647E",
  gutter: "#F7F7FC",
  gutterText: "#8C8CA6",
  indentGuide: "rgba(91, 91, 247, 0.16)",
  tokens: {
    keyword: { color: "#4B4BE6" },
    built_in: { color: "#7C3AED" },
    type: { color: "#0A6FAD" },
    literal: { color: "#C2410C" },
    number: { color: "#C2410C" },
    string: { color: "#0B7D60" },
    regexp: { color: "#BE185D" },
    symbol: { color: "#BE185D" },
    "char.escape": { color: "#BE185D" },
    subst: { color: "#23233A" },
    comment: { color: "#6E6E8C", italic: true },
    doctag: { color: "#5B5B78", bold: true },
    quote: { color: "#6E6E8C", italic: true },
    meta: { color: "#5A6478" },
    "meta.keyword": { color: "#4B4BE6" },
    "meta.string": { color: "#0B7D60" },
    title: { color: "#A3168F" },
    "title.class": { color: "#0A6FAD" },
    "title.class.inherited": { color: "#0A6FAD" },
    "title.function": { color: "#A3168F" },
    params: { color: "#3A3A55" },
    variable: { color: "#23233A" },
    "variable.language": { color: "#7C3AED", italic: true },
    "variable.constant": { color: "#C2410C" },
    property: { color: "#9A4A06" },
    attr: { color: "#9A4A06" },
    attribute: { color: "#9A4A06" },
    tag: { color: "#5A6478" },
    name: { color: "#C5283F" },
    "selector-tag": { color: "#C5283F" },
    "selector-id": { color: "#A3168F" },
    "selector-class": { color: "#A3168F" },
    "selector-attr": { color: "#9A4A06" },
    "selector-pseudo": { color: "#7C3AED" },
    "template-tag": { color: "#4B4BE6" },
    "template-variable": { color: "#C2410C" },
    operator: { color: "#4B4B66" },
    punctuation: { color: "#4B4B66" },
    section: { color: "#4B4BE6", bold: true },
    bullet: { color: "#C2410C" },
    link: { color: "#0A6FAD" },
    code: { color: "#0B7D60" },
    emphasis: { italic: true },
    strong: { bold: true },
    addition: { color: "#15803D" },
    deletion: { color: "#B91C1C" },
  },
};

/** "Loom Night": original dark theme, the night counterpart of {@link LOOM_DAY}. */
export const LOOM_NIGHT: CodeTheme = {
  name: "loom-night",
  scheme: "dark",
  page: "#0B0B12",
  background: "#14141F",
  foreground: "#E4E4EF",
  border: "rgba(255, 255, 255, 0.10)",
  shadow: "0 1px 2px rgba(0, 0, 0, 0.4), 0 24px 60px -16px rgba(0, 0, 0, 0.7)",
  titleBar: "#191926",
  titleText: "#E4E4EF",
  muted: "#9A9AB4",
  gutter: "#161622",
  gutterText: "#6F6F8C",
  indentGuide: "rgba(154, 156, 255, 0.16)",
  tokens: {
    keyword: { color: "#9A9CFF" },
    built_in: { color: "#C4A1FF" },
    type: { color: "#6CC4FF" },
    literal: { color: "#FFB070" },
    number: { color: "#FFB070" },
    string: { color: "#5FD4B0" },
    regexp: { color: "#FF8FB8" },
    symbol: { color: "#FF8FB8" },
    "char.escape": { color: "#FF8FB8" },
    subst: { color: "#E4E4EF" },
    comment: { color: "#8585A3", italic: true },
    doctag: { color: "#A3A3C2", bold: true },
    quote: { color: "#8585A3", italic: true },
    meta: { color: "#93A0B8" },
    "meta.keyword": { color: "#9A9CFF" },
    "meta.string": { color: "#5FD4B0" },
    title: { color: "#F28BE6" },
    "title.class": { color: "#6CC4FF" },
    "title.class.inherited": { color: "#6CC4FF" },
    "title.function": { color: "#F28BE6" },
    params: { color: "#CFCFE0" },
    variable: { color: "#E4E4EF" },
    "variable.language": { color: "#C4A1FF", italic: true },
    "variable.constant": { color: "#FFB070" },
    property: { color: "#F5C26B" },
    attr: { color: "#F5C26B" },
    attribute: { color: "#F5C26B" },
    tag: { color: "#93A0B8" },
    name: { color: "#FF7A8A" },
    "selector-tag": { color: "#FF7A8A" },
    "selector-id": { color: "#F28BE6" },
    "selector-class": { color: "#F28BE6" },
    "selector-attr": { color: "#F5C26B" },
    "selector-pseudo": { color: "#C4A1FF" },
    "template-tag": { color: "#9A9CFF" },
    "template-variable": { color: "#FFB070" },
    operator: { color: "#AEAEC8" },
    punctuation: { color: "#AEAEC8" },
    section: { color: "#9A9CFF", bold: true },
    bullet: { color: "#FFB070" },
    link: { color: "#6CC4FF" },
    code: { color: "#5FD4B0" },
    emphasis: { italic: true },
    strong: { bold: true },
    addition: { color: "#6EE7A0" },
    deletion: { color: "#FF8A8A" },
  },
};

/** Theme for a colour scheme. */
export function codeTheme(scheme: "light" | "dark"): CodeTheme {
  return scheme === "dark" ? LOOM_NIGHT : LOOM_DAY;
}

const styleCache = new WeakMap<CodeTheme, Map<string, TokenStyle | null>>();

/**
 * Resolves the style of a token scope chain (outermost first, space separated, as produced by
 * the highlighter). The innermost scope with a style wins; within one scope the most specific
 * key wins.
 */
export function resolveTokenStyle(theme: CodeTheme, scope: string): TokenStyle | null {
  if (!scope) return null;
  let cache = styleCache.get(theme);
  if (!cache) {
    cache = new Map();
    styleCache.set(theme, cache);
  }
  const hit = cache.get(scope);
  if (hit !== undefined) return hit;

  let found: TokenStyle | null = null;
  const chain = scope.split(" ");
  for (let i = chain.length - 1; i >= 0 && !found; i--) {
    let key = chain[i] ?? "";
    while (key && !found) {
      found = theme.tokens[key] ?? null;
      const dot = key.lastIndexOf(".");
      key = dot === -1 ? "" : key.slice(0, dot);
    }
  }
  cache.set(scope, found);
  return found;
}

/** Inline CSS declarations for a token style, or "" when it has none. */
export function tokenCss(style: TokenStyle | null): string {
  if (!style) return "";
  let css = "";
  if (style.color) css += `color:${style.color};`;
  if (style.italic) css += "font-style:italic;";
  if (style.bold) css += "font-weight:600;";
  return css;
}
