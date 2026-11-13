import createDOMPurify, { type Config, type WindowLike } from "dompurify";

/** Elements that never belong in a captured page: frames, plugins and document-level controls. */
const FORBID_TAGS = ["iframe", "frame", "frameset", "object", "embed", "base", "meta", "portal", "foreignObject"];

/**
 * Shared policy: everything that renders is kept (inline styles, `<style>`, SVG, form controls as
 * visuals, `<link rel=stylesheet>`); scripts, event handlers, script URLs, frames, plugins and
 * SVG `foreignObject` are removed. A `<` in `<style>` text that would read as markup is escaped
 * first (see {@link escapeCssMarkup}).
 */
const BASE_CONFIG: Config = {
  ADD_TAGS: ["link"],
  ADD_ATTR: ["target"],
  FORBID_TAGS,
  ALLOW_DATA_ATTR: true,
  RETURN_TRUSTED_TYPE: false,
};

/**
 * Fragments are laid out inside a shadow root, where element ids do not become document
 * properties, so ids such as "title" are kept (SANITIZE_DOM off).
 */
const FRAGMENT_CONFIG: Config = { ...BASE_CONFIG, FORCE_BODY: true, SANITIZE_DOM: false };

/**
 * Whole documents get their own frame document, where `<img name="body">` would shadow
 * `document.body` for the snapshotter, so DOM clobbering protection stays on.
 */
const DOCUMENT_CONFIG: Config = { ...BASE_CONFIG, WHOLE_DOCUMENT: true };

const HTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * A `<` that DOMPurify reads as markup (its ELEMENT_MARKUP_PROBE). DOMPurify removes a whole
 * `<style>` whose text has one, and valid CSS often has one: `@property` syntax strings such as
 * `"<color>"` (Tailwind v4 gradients), comments, SVG data: URLs and media ranges like `(width<40em)`.
 */
const MARKUP_LT = /<[/\w!]/;

/**
 * The places a `<` can sit in CSS text, read like the CSS tokenizer: a comment; a string (an
 * unterminated one ends at a newline or the end); an unquoted `url(`; an escape; a brace; a CDO
 * `<!--`; or a bare `<` before `/`, `!` or a word character. Everything else is kept as it is.
 */
const CSS_LT_PLACES =
  /\/\*[\s\S]*?(?:\*\/|$)|(["'])(?:(?!\1)[^\\\n\r\f]|\\[\s\S])*(?:\1|\\?$|(?=[\n\r\f]))|(?<![\w\x80-\uffff\\-])url\((?![ \t\n\r\f]*["'])[ \t\n\r\f]*(?:[^\\)"'( \t\n\r\f]|\\[\s\S])*|\\[\s\S]?|[{}]|<!--|<(?=[/\w!])/gi;
/** An escape (kept whole, so `\\<` stays a backslash then `<`) or a markup-like `<`. */
const QUOTED_LT = /\\[\s\S]|<(?=[/\w!])/g;

/**
 * Rewrites CSS so that no `<` is followed by `/`, `!` or a word character, so the text can never
 * open a tag or a `<!` comment wherever it is parsed, while the style sheet keeps its meaning. In
 * strings, comments, unquoted URLs and names, `<` (or `\<`) becomes the escape `\3c ` (its space
 * ends the escape). A CDO `<!--` at the top level, where it is ignored, becomes a space. Any other
 * `<` gets a space after it, which media and container ranges such as `(width<40em)` allow; only a
 * custom property holding a bare `<` (`--v:<a>`) reads differently, as `< a`.
 */
function escapeCssMarkup(css: string): string {
  if (!MARKUP_LT.test(css)) return css;
  let depth = 0;
  return css.replace(CSS_LT_PLACES, (m) => {
    switch (m) {
      case "{":
        depth++;
        return m;
      case "}":
        depth = Math.max(0, depth - 1);
        return m;
      case "<!--":
        // Inside a block a CDO starts an invalid rule; keep it invalid there.
        return depth === 0 ? " " : "< !--";
      case "<":
        return "< ";
      default:
        return m.replace(QUOTED_LT, (e) => (e.endsWith("<") ? "\\3c " : e));
    }
  });
}

/**
 * Escapes markup-like `<` in an HTML `<style>` before DOMPurify judges it, so a valid style sheet
 * is kept instead of removed whole. A `<style>` with element children (never built by the HTML
 * parser) or outside the HTML namespace is left for DOMPurify to judge.
 */
function escapeStyleText(el: Element): void {
  if (el.namespaceURI !== HTML_NS || el.firstElementChild) return;
  const css = el.textContent ?? "";
  const escaped = escapeCssMarkup(css);
  if (escaped !== css) el.textContent = escaped;
}

const PROBE_IN = '<p title="t">a</p><img src="x.png" onerror="e()"><script>s()</script>';
const PROBE_OUT = '<p title="t">a</p><img src="x.png">';

const instances = new WeakMap<object, ReturnType<typeof createDOMPurify>>();

function purifier(win: Window): ReturnType<typeof createDOMPurify> {
  let p = instances.get(win);
  if (p) return p;
  p = createDOMPurify(win as unknown as WindowLike);
  // Fail closed: some DOM emulations (e.g. happy-dom) run DOMPurify without errors but let
  // scripts through. A known input must come out exactly clean before anything is trusted.
  if (!p.isSupported || p.sanitize(PROBE_IN, { RETURN_TRUSTED_TYPE: false }) !== PROBE_OUT) {
    throw new Error("html: this DOM environment cannot sanitize HTML reliably; run in a browser");
  }
  p.addHook("uponSanitizeElement", (node, data) => {
    // Runs before DOMPurify's markup check on the element's text.
    if (data.tagName === "style") return escapeStyleText(node as Element);
    if (data.tagName !== "link") return;
    const el = node as Element;
    const rel = (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    // Disarm rather than remove: removing nodes from a hook disturbs DOMPurify's tree walk.
    if (!rel.includes("stylesheet") || rel.includes("import")) el.removeAttribute("href");
  });
  instances.set(win, p);
  return p;
}

/**
 * Sanitizes an HTML fragment before it is laid out in the host document (where, unlike in a
 * sandbox frame, an `<img onerror>` would run).
 */
export function sanitizeFragment(html: string, win: Window): string {
  return purifier(win).sanitize(html, FRAGMENT_CONFIG) as string;
}

/** Sanitizes a whole document; returns `<html>...</html>` markup without a doctype. */
export function sanitizeDocument(html: string, win: Window): string {
  return purifier(win).sanitize(html, DOCUMENT_CONFIG) as string;
}
