/**
 * Book style sheets, made safe for the stage: rules are scoped under the chapter wrapper, url()
 * references are resolved inside the archive (anything else is dropped, so nothing is fetched),
 * fixed positioning is neutralised and @font-face rules are turned into FontFace registrations.
 */

/** Resolves a url() of a style sheet: blob URL, or null to drop it. */
export type UrlResolver = (href: string, base: string) => string | null;

/** A font declared by a book style sheet. */
export interface FontFaceSpec {
  family: string;
  /** Archive path of the font file. */
  path: string;
  weight?: string;
  style?: string;
}

/** Result of {@link scopeStylesheet}. */
export interface ScopedSheet {
  css: string;
  fonts: FontFaceSpec[];
}

const MAX_CSS_CHARS = 512 * 1024;
const MAX_RULES = 5000;

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** Splits a selector list at top-level commas (commas inside (), [] or quotes are kept). */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

const ROOT_RE = /(^|[\s>+~(,])(?:html|:root)(?=$|[\s>+~.#:[)])/gi;
const BODY_RE = /(^|[\s>+~(,])body(?=$|[\s>+~.#:[)])/gi;

/**
 * Scopes one selector under `.epub-html<scope>`: `html`/`:root` map to the wrapper, `body` to
 * `.epub-body`. Returns null for selectors that must not apply (shadow-tree selectors).
 */
export function scopeSelector(selector: string, scope: string): string | null {
  if (/:host|::slotted|::part|@/i.test(selector)) return null;
  const s = selector.trim().replace(ROOT_RE, "$1.epub-html").replace(BODY_RE, "$1.epub-body");
  if (s === "") return null;
  return s.startsWith(".epub-html") ? `.epub-html${scope}${s.slice(".epub-html".length)}` : `.epub-html${scope} ${s}`;
}

/** Rewrites a `font-family` value (for the F01 fallback stack). */
export type FamilyRewriter = (value: string) => string;

const FAMILY_RE = /(^|[;{\s])font-family\s*:\s*([^;}]+)/gi;

/**
 * Rewrites url() references of a declaration block, neutralises fixed positioning and (when
 * `family` is given) extends font-family values with their fallback stacks.
 */
export function cleanDeclarations(text: string, base: string, resolve: UrlResolver, family?: FamilyRewriter): string {
  const families = family
    ? text.replace(FAMILY_RE, (_m, pre: string, value: string) => {
        const important = /!\s*important\s*$/i.test(value);
        const stack = family(value.replace(/!\s*important\s*$/i, "").trim());
        return `${pre}font-family: ${stack}${important ? " !important" : ""}`;
      })
    : text;
  return families
    .replace(URL_RE, (_m, a?: string, b?: string, c?: string) => {
      const url = resolve((a ?? b ?? c ?? "").trim(), base);
      return url ? `url("${url}")` : "none";
    })
    .replace(/position\s*:\s*fixed/gi, "position: absolute")
    .replace(/position\s*:\s*sticky/gi, "position: relative");
}

interface RuleLike {
  cssText: string;
  selectorText?: string;
  style?: CSSStyleDeclaration;
  cssRules?: CSSRuleList;
  media?: MediaList;
  conditionText?: string;
}

function fontFace(
  rule: RuleLike,
  base: string,
  resolveFont: (href: string, base: string) => string | null,
): FontFaceSpec | null {
  const style = rule.style;
  if (!style) return null;
  const family = style
    .getPropertyValue("font-family")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!family) return null;
  for (const m of style.getPropertyValue("src").matchAll(URL_RE)) {
    const path = resolveFont((m[1] ?? m[2] ?? m[3] ?? "").trim(), base);
    if (!path) continue;
    const spec: FontFaceSpec = { family, path };
    const weight = style.getPropertyValue("font-weight").trim();
    const fstyle = style.getPropertyValue("font-style").trim();
    if (weight) spec.weight = weight;
    if (fstyle) spec.style = fstyle;
    return spec;
  }
  return null;
}

function screenMedia(media: string): boolean {
  const m = media.trim().toLowerCase();
  return (
    m === "" ||
    /\b(?:all|screen)\b/.test(m) ||
    !/\b(?:print|speech|aural|braille|embossed|handheld|projection|tty|tv)\b/.test(m)
  );
}

/**
 * Parses a book style sheet with the CSSOM of `win` and returns it scoped under
 * `.epub-html<scope>` (`scope` is a class selector such as `.epub-s1`).
 *
 * @param resolveUrl Images and other url() values.
 * @param resolveFont Font files: returns the archive path of a usable font, or null.
 */
export function scopeStylesheet(
  text: string,
  scope: string,
  base: string,
  win: object,
  resolveUrl: UrlResolver,
  resolveFont: (href: string, base: string) => string | null,
  family?: FamilyRewriter,
): ScopedSheet {
  const Sheet = (win as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  if (!Sheet || text.length > MAX_CSS_CHARS) return { css: "", fonts: [] };
  const sheet = new Sheet();
  try {
    // Statement at-rules go first: @import must never pull in other files (replaceSync ignores
    // it in browsers, but some CSSOM implementations lose the rest of the sheet).
    sheet.replaceSync(text.replace(/@(?:import|charset|namespace)\b[^;{}]*;/gi, ""));
  } catch {
    return { css: "", fonts: [] };
  }
  const fonts: FontFaceSpec[] = [];
  let count = 0;
  const walk = (rules: CSSRuleList): string => {
    let out = "";
    for (const r of Array.from(rules)) {
      if (++count > MAX_RULES) break;
      const rule = r as unknown as RuleLike;
      const head = rule.cssText.trimStart().slice(0, 12).toLowerCase();
      if (rule.selectorText !== undefined && rule.style) {
        const selectors = splitSelectors(rule.selectorText)
          .map((s) => scopeSelector(s, scope))
          .filter((s): s is string => s !== null);
        if (selectors.length > 0)
          out += `${selectors.join(",")}{${cleanDeclarations(rule.style.cssText, base, resolveUrl, family)}}`;
      } else if (head.startsWith("@media") && rule.cssRules) {
        const media = rule.media?.mediaText ?? "";
        if (screenMedia(media)) {
          const inner = walk(rule.cssRules);
          if (inner) out += media ? `@media ${media}{${inner}}` : inner;
        }
      } else if (head.startsWith("@supports") && rule.cssRules) {
        const inner = walk(rule.cssRules);
        if (inner && rule.conditionText) out += `@supports ${rule.conditionText}{${inner}}`;
      } else if (head.startsWith("@font-face")) {
        const face = fontFace(rule, base, resolveFont);
        if (face) fonts.push(face);
      }
      // @import, @page, @namespace, @keyframes and unknown rules are dropped.
    }
    return out;
  };
  return { css: walk(sheet.cssRules), fonts };
}
