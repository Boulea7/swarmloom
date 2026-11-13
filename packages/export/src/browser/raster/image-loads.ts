import { animationMark, animationsOf, sheetApplies, sheetsOf } from "./reads";

/** The `url()`s of a CSS value as the CSSOM serialises it: quoted, with backslash escapes. */
const CSS_URL = /url\("((?:[^"\\]|\\.)*)"\)/g;
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Image elements loading what CSS values of a document name, by document and URL. */
const probes = new WeakMap<Document, Map<string, HTMLImageElement>>();
/** By document, the last value whose images had all loaded or failed: they stay so. */
const lastLoaded = new WeakMap<Document, string>();

function unescaped(raw: string): string {
  return raw.includes("\\") ? raw.replace(/\\(.)/g, "$1") : raw;
}

/** The image element of `doc` loading `url`, made when `make` holds and there is none yet. */
function probeOf(doc: Document, url: string, make: boolean): HTMLImageElement | null {
  let known = probes.get(doc);
  let probe = known?.get(url) ?? null;
  if (probe || !make) return probe;
  if (!known) {
    known = new Map();
    probes.set(doc, known);
  }
  probe = doc.createElementNS(XHTML_NS, "img") as HTMLImageElement;
  probe.src = url;
  known.set(url, probe);
  return probe;
}

/**
 * Whether `doc` still loads an image that `value`, a computed CSS value, names. A CSS image fires no
 * event once it has loaded. An image element of the same document given the same URL shares the
 * document's fetch of it (Chromium and Firefox fetch an image once per document and URL), so it is
 * `complete` once the page's image has loaded or failed: by then the boxes laid out by it took its
 * size. Each such element stays for the document's life and answers at once from then on.
 */
export function cssImagePending(doc: Document, value: string): boolean {
  // An inherited value comes again and again: each item of a list with an inlined bullet names it.
  if (lastLoaded.get(doc) === value) return false;
  for (const [, raw = ""] of value.matchAll(CSS_URL)) {
    const url = unescaped(raw);
    if (!url || url.startsWith("#")) continue;
    if (!(probeOf(doc, url, true) as HTMLImageElement).complete) return true;
  }
  lastLoaded.set(doc, value);
  return false;
}

/**
 * Functions whose image only the engine works out: substitutions (`var()`, `attr()`, `env()`,
 * `if()`, custom functions, each name read from its start), `src()` and the option `image-set()`
 * picks. Searched in a value without its `url()`s.
 */
const ENGINE_PICKED = /(?:var|attr|env|if|src|image-set)\(|(?<![\w-])--[\w-]*\(/i;

/**
 * Adds to `urls` the marker images a declaration block gives (`list-style-image`, also through the
 * `list-style` shorthand), resolved against `base` (null when not known). False when one of them
 * cannot be told from the declaration.
 */
function blockMarkers(style: CSSStyleDeclaration, base: string | null, urls: Set<string>): boolean {
  for (const name of ["list-style-image", "list-style"]) {
    const value = style.getPropertyValue(name);
    if (!value.includes("(")) continue;
    // What is left once the quoted URLs are out: an unquoted one would be another serialisation.
    const rest = value.replace(CSS_URL, "");
    if (rest.includes("url(") || ENGINE_PICKED.test(rest)) return false;
    for (const [, raw = ""] of value.matchAll(CSS_URL)) {
      const url = unescaped(raw);
      if (!url || url.startsWith("#")) continue;
      const absolute = /^[a-z][a-z\d+.-]*:/i.test(url);
      if (!absolute && base === null) return false;
      try {
        urls.add(new URL(url, base ?? undefined).href);
      } catch {
        return false;
      }
    }
  }
  return true;
}

/** {@link blockMarkers} for every rule of `rules`, nested and imported rules included. */
function rulesMarkers(rules: CSSRuleList, base: string | null, urls: Set<string>): boolean {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule & {
      style?: CSSStyleDeclaration;
      cssRules?: CSSRuleList;
      styleSheet?: CSSStyleSheet | null;
    };
    if (rule.styleSheet) {
      if (!sheetMarkers(rule.styleSheet, rule.styleSheet.href, urls)) return false;
      continue;
    }
    if (rule.style && !blockMarkers(rule.style, base, urls)) return false;
    if (rule.cssRules && !rulesMarkers(rule.cssRules, base, urls)) return false;
  }
  return true;
}

/** {@link rulesMarkers} for a style sheet: false when its rules cannot be read (another origin's). */
function sheetMarkers(sheet: CSSStyleSheet, base: string | null, urls: Set<string>): boolean {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return false;
  }
  return rulesMarkers(rules, base, urls);
}

/**
 * Whether an animation may set a list marker image that no declaration names: one a script made,
 * or a transition (it may run from a value whose rule is gone). A CSS animation runs the keyframes
 * of a rule.
 */
function animatesMarker(animation: Animation): boolean {
  const kind = Object.prototype.toString.call(animation).slice(8, -1);
  if (kind === "CSSAnimation") return false;
  if (kind === "CSSTransition") return (animation as CSSTransition).transitionProperty.startsWith("list-style");
  const names = animationMark(animation).names();
  return !names || names.some((name) => name.startsWith("list-style"));
}

/**
 * Whether every list marker image the CSS of `scopes` (`doc` and its shadow roots) names has loaded
 * or failed in `doc`, so no list item there waits for its marker: the images that `list-style-image`
 * and `list-style` name in the style sheets that apply (keyframes, nested and imported rules
 * included) and in `style` attributes. The value of a list item is one of those or inherits one,
 * and reading it on every item serialises an inlined bullet's whole data URL again for each. False
 * when one of them cannot be told: a style sheet of another origin, a value the engine works out
 * ({@link ENGINE_PICKED}), a relative URL in a sheet a script made (its base URL is not known), or an
 * animation that may set one ({@link animatesMarker}). An image named by a data URL is loaded for
 * the check; one at another URL must have been found on a box already ({@link cssImagePending}),
 * since the check fetches nothing that no box uses: until then this is false.
 */
export function markerImagesLoaded(doc: Document, scopes: readonly (Document | ShadowRoot)[]): boolean {
  const urls = new Set<string>();
  for (const scope of scopes) {
    for (const sheet of sheetsOf(scope)) {
      if (!sheetApplies(sheet, scope)) continue;
      const base = sheet.ownerNode ? (sheet.href ?? doc.baseURI) : null;
      if (!sheetMarkers(sheet, base, urls)) return false;
    }
    for (const el of Array.from(scope.querySelectorAll("[style]"))) {
      const text = el.getAttribute("style") ?? "";
      if (!text.includes("\\") && !/list-style/i.test(text)) continue;
      const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
      if (!style || !blockMarkers(style, doc.baseURI, urls)) return false;
    }
    if (animationsOf(scope).some(animatesMarker)) return false;
  }
  for (const url of urls) if (!probeOf(doc, url, url.startsWith("data:"))?.complete) return false;
  return true;
}
