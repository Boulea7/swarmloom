import { SVG_NS } from "./units";

/** SMIL animation elements (decision C04); their own `href`s are `#fragment`-only like everywhere else. */
export const SMIL_ELEMENTS: ReadonlySet<string> = new Set([
  "animate",
  "animateTransform",
  "animateMotion",
  "set",
  "mpath",
]);

/**
 * Allow-list sanitiser for untrusted SVG.
 *
 * Runs on an inert document (from DOMParser) before anything touches a live document. It keeps the
 * drawing vocabulary and SMIL animation (decision C04: `animate`, `animateTransform`,
 * `animateMotion`, `set`, `mpath`) and removes everything that can run script, navigate or load
 * external resources: `script`, `foreignObject`, event handler attributes, non-fragment `href`s
 * (except `data:` raster/SVG images), external `url()` and `image-set()` references (CSS escapes
 * decoded first), `@import`, legacy CSS script hooks, and animations that target links or handlers
 * or carry such values. Elements outside the SVG namespace are dropped.
 */

/** SVG elements that survive sanitising (case-sensitive local names). */
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "a",
  "switch",
  "title",
  "desc",
  "style",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "image",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "clipPath",
  "mask",
  "marker",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  ...SMIL_ELEMENTS,
]);

/** Removed elements whose content would have been visible: reported to the user. */
const VISIBLE_CONTENT = new Set(["foreignObject", "image", "feImage"]);

const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i;
const SAFE_FONT_DATA =
  /^data:(?:font\/[\w.+-]+|application\/(?:font-woff2?|x-font-woff|font-sfnt|x-font-ttf|x-font-otf))[;,]/i;
const FRAGMENT = /^#[^\s#]+$/;
/** Matches `url(...)` with optional quotes; group 2 is the target. */
const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

export interface SanitizeReport {
  /** Removed element names with counts. */
  removed: Record<string, number>;
  /** Elements with visible content that had to be dropped (foreignObject, external images). */
  droppedContent: number;
  /** Attributes removed (event handlers, unsafe links and references). */
  removedAttributes: number;
}

export function createReport(): SanitizeReport {
  return { removed: {}, droppedContent: 0, removedAttributes: 0 };
}

/** Strips control characters and whitespace the URL parser ignores, lower-cased. */
function normaliseUrl(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we strip.
  return value.replace(/[\u0000- \u007f]+/g, "").toLowerCase();
}

function isScriptUrl(value: string): boolean {
  const v = normaliseUrl(value);
  return v.includes("javascript:") || v.includes("vbscript:") || v.startsWith("data:text/html");
}

/** A `href` is allowed when it points inside the document, or is an inline image for image elements. */
export function isAllowedHref(tag: string, value: string): boolean {
  const v = value.trim();
  if (FRAGMENT.test(v)) return true;
  if (tag === "image" || tag === "feImage") return SAFE_IMAGE_DATA.test(v);
  return false;
}

function isSafeCssUrl(target: string): boolean {
  const t = target.trim();
  return FRAGMENT.test(t) || SAFE_IMAGE_DATA.test(t) || SAFE_FONT_DATA.test(t);
}

/** True when every `url()` in an attribute value is a same-document fragment reference. */
function hasOnlyFragmentUrls(value: string): boolean {
  const opened = value.match(/url\s*\(/gi)?.length ?? 0;
  if (opened === 0) return true;
  const urls = Array.from(value.matchAll(CSS_URL));
  // A url( left open still loads (CSS ends the token with the value), so each one must close.
  return urls.length === opened && urls.every((m) => FRAGMENT.test((m[2] ?? "").trim()));
}

/** Functions that load a URL written as a plain string: `image-set('a.png' 1x)`, `src("a.png")`. */
const STRING_URL_FN = /(?:-webkit-)?image-set\s*\(|\bsrc\s*\(/i;

/**
 * True when an attribute or animation value could reach outside the document. Browsers parse
 * presentation attributes and animated values as CSS, so escapes are decoded first (`u\72l(` is
 * `url(`); then a script URL, a `url()` that is not a `#fragment`, or a function that takes a bare
 * URL string counts as external.
 */
function loadsExternal(value: string): boolean {
  const v = decodeCssEscapes(value);
  return isScriptUrl(v) || STRING_URL_FN.test(v) || !hasOnlyFragmentUrls(v);
}

/**
 * Decodes CSS escapes (`\72` hex, `\(` literal) so they cannot hide `url(` or `@import`.
 * Invalid code points become U+FFFD, as in the CSS syntax specification.
 */
export function decodeCssEscapes(css: string): string {
  return css.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f0-9a-fA-F]))|\\[\n\r\f]/g,
    (_m, hex?: string, ch?: string) => {
      if (hex) {
        const cp = Number.parseInt(hex, 16);
        return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "\ufffd" : String.fromCodePoint(cp);
      }
      return ch ?? "";
    },
  );
}

/**
 * Sanitises CSS text (style elements and style attributes): drops `@import`, replaces every
 * `url()` that is not a fragment or an inline image/font with `none`, and neutralises legacy
 * script hooks. CSS escapes are removed first so they cannot spell `url(` or `@import` in disguise.
 * The decoded text is what gets written back, and the browser decodes it again, so backslashes left
 * over (from `\\` or `\5c`) are dropped too: `\\75rl(` decodes to `\75rl(`, which CSS reads as `url(`.
 * (`loadsExternal` must not do this: it keeps the original value, and `url(\\#a)` loads `\#a`.)
 */
export function sanitizeCss(css: string): string {
  let out = decodeCssEscapes(css).replace(/\\/g, "");
  // A space, not "": deleting the inner rule of `@imp@import "a";ort "https://…"` would join a new @import.
  out = out.replace(/@import\b[^;]*;?/gi, " ");
  out = out.replace(CSS_URL, (whole, _q: string, target: string) => (isSafeCssUrl(target) ? whole : "none"));
  // An unbalanced url( could still hide a request, and image-set()/src() accept bare strings.
  out = out.replace(/url\s*\((?![^)]*\))/gi, "none(");
  out = out.replace(/(?:-webkit-)?image-set\s*\(|\bsrc\s*\(/gi, "invalid(");
  out = out.replace(/expression\s*\(/gi, "invalid(");
  out = out.replace(/-moz-binding|behavior\s*:/gi, "invalid:");
  out = out.replace(/javascript:/gi, "invalid:");
  return out;
}

/**
 * True for an animation that could navigate, run handlers or load resources once it plays.
 * SMIL resolves the `attributeName` prefix through the namespaces in scope, so any prefix can name
 * xlink: the checks look at the local part after the colon, never at the literal `xlink:` prefix.
 */
function unsafeAnimation(el: Element): boolean {
  const target = (el.getAttribute("attributeName") ?? "").trim().toLowerCase();
  const local = target.slice(target.lastIndexOf(":") + 1);
  if (local === "href" || local.startsWith("on") || local === "style") return true;
  // Values may only reference local fragments and never carry script or data URLs.
  for (const name of ["values", "from", "to", "by"]) {
    const v = el.getAttribute(name);
    if (v && (loadsExternal(v) || /data:/i.test(decodeCssEscapes(v)))) return true;
  }
  return false;
}

function count(report: SanitizeReport, name: string): void {
  report.removed[name] = (report.removed[name] ?? 0) + 1;
}

function sanitizeAttributes(el: Element, report: SanitizeReport): void {
  for (const attr of Array.from(el.attributes)) {
    const local = attr.localName.toLowerCase();
    const value = attr.value;
    let drop = false;
    if (local.startsWith("on")) drop = true;
    else if (local === "href") {
      if (!isAllowedHref(el.localName, value)) {
        drop = true;
        if (VISIBLE_CONTENT.has(el.localName) && value.trim() !== "") report.droppedContent++;
      }
    } else if (attr.name === "xml:base") drop = true;
    else if (local === "style") {
      const clean = sanitizeCss(value);
      if (clean !== value) attr.value = clean;
    } else if (loadsExternal(value)) drop = true;
    if (drop) {
      el.removeAttributeNode(attr);
      report.removedAttributes++;
    }
  }
}

/**
 * Sanitises `root` and all its descendants in place. The root itself must be an SVG `<svg>`.
 * Comments and processing instructions are removed too.
 */
export function sanitizeSvgTree(root: Element, report: SanitizeReport = createReport()): SanitizeReport {
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop() as Element;
    sanitizeAttributes(el, report);
    if (el.localName === "style") {
      el.textContent = sanitizeCss(el.textContent ?? "");
      continue;
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) {
        const c = child as Element;
        if (
          c.namespaceURI !== SVG_NS ||
          !ALLOWED_ELEMENTS.has(c.localName) ||
          (SMIL_ELEMENTS.has(c.localName) && c.localName !== "mpath" && unsafeAnimation(c))
        ) {
          count(report, c.localName);
          if (c.localName === "foreignObject") report.droppedContent++;
          c.remove();
          continue;
        }
        stack.push(c);
      } else if (child.nodeType === 7 || child.nodeType === 8) {
        child.remove();
      }
    }
  }
  return report;
}
