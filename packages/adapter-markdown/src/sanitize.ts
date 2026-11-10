import createDOMPurify, { type Config, type WindowLike } from "dompurify";

/**
 * Elements removed from rendered Markdown even though DOMPurify would allow them: global style
 * sheets, forms and embeds have no place in a document that is laid out and replayed.
 */
const FORBID_TAGS = [
  "style",
  "foreignObject",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "iframe",
  "frame",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "noscript",
];

/** DOMPurify's default URI rule plus blob: (local images opened in the Studio). */
const ALLOWED_URI = /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const DOCUMENT_CONFIG: Config = {
  FORBID_TAGS,
  ALLOWED_URI_REGEXP: ALLOWED_URI,
  ALLOW_DATA_ATTR: true,
  // Heading ids such as "title" or "location" would otherwise be dropped as DOM clobbering
  // risks. The HTML is only ever mounted inside shadow roots and sandboxes, where element ids
  // do not become named properties of window or document.
  SANITIZE_DOM: false,
  RETURN_TRUSTED_TYPE: false,
};

const SVG_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ["style"],
  FORBID_TAGS: ["foreignObject"],
  ALLOWED_URI_REGEXP: ALLOWED_URI,
  RETURN_TRUSTED_TYPE: false,
};

const instances = new WeakMap<object, ReturnType<typeof createDOMPurify>>();

const PROBE_IN = '<p title="t">a</p><img src="x.png" onerror="e()"><script>s()</script>';
const PROBE_OUT = '<p title="t">a</p><img src="x.png">';

function purifier(win: Window): ReturnType<typeof createDOMPurify> {
  let p = instances.get(win);
  if (!p) {
    p = createDOMPurify(win as unknown as WindowLike);
    // Fail closed: some DOM emulations (e.g. happy-dom) run DOMPurify without errors but let
    // scripts through. A known input must come out exactly clean before anything is trusted.
    if (!p.isSupported || p.sanitize(PROBE_IN, { RETURN_TRUSTED_TYPE: false }) !== PROBE_OUT) {
      throw new Error("markdown: this DOM environment cannot sanitize HTML reliably; run in a browser");
    }
    instances.set(win, p);
  }
  return p;
}

/**
 * Sanitizes rendered Markdown: drops scripts, event handlers, javascript: URLs, forms, embeds and
 * style sheets; keeps inline styles, classes, ids, ARIA and data attributes, SVG and MathML.
 */
export function sanitizeDocument(html: string, win: Window): string {
  return purifier(win).sanitize(html, DOCUMENT_CONFIG) as string;
}

/** Sanitizes a diagram SVG (scripts, handlers and foreign HTML removed; its own styles kept). */
export function sanitizeSvg(svg: string, win: Window): string {
  return purifier(win).sanitize(svg, SVG_CONFIG) as string;
}
