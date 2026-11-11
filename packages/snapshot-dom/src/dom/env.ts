/*
 * Realm-safe DOM helpers. Snapshots often run against documents of other realms (same-origin
 * iframes, sandboxes), where `instanceof HTMLElement` is false, so checks use nodeType/namespace.
 */

export const XHTML_NS = "http://www.w3.org/1999/xhtml";
export const SVG_NS = "http://www.w3.org/2000/svg";
export const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

/** Elements carrying this attribute (and their subtrees) are never captured, e.g. the player host. */
export const IGNORE_ATTR = "data-swarmloom-ignore";
/** Elements carrying this attribute become a media placeholder labelled with its value. */
export const MEDIA_ATTR = "data-swarmloom-media";
/**
 * Elements carrying this attribute keep their markup (classes, inline styles, simple SVG) as one
 * piece of a text layer instead of computed styles: for layouts that only the caller's style sheet
 * can reproduce, such as KaTeX formulas. The caller passes that sheet as `Blueprint.css`.
 */
export const VERBATIM_ATTR = "data-swarmloom-verbatim";

export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

export function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

export function isDocument(node: unknown): node is Document {
  return typeof node === "object" && node !== null && (node as Node).nodeType === 9;
}

export function isHtmlElement(el: Element): el is HTMLElement {
  return el.namespaceURI === XHTML_NS;
}

export function isSvgElement(el: Element): el is SVGElement {
  return el.namespaceURI === SVG_NS;
}

/** The window that lays out `node`; throws for documents without a browsing context. */
export function viewOf(node: Node): Window {
  const doc = node.nodeType === 9 ? (node as Document) : node.ownerDocument;
  const view = doc?.defaultView;
  if (!view) throw new TypeError("snapshot: the document has no window (is it detached?)");
  return view;
}

/** Non-rendering elements that never produce layers (most are display:none by UA style anyway). */
export const SKIP_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "head",
  "meta",
  "link",
  "title",
  "base",
  "source",
  "track",
  "param",
  "datalist",
  "area",
  "map",
  "colgroup",
  "col",
]);

/** Replaced or embedded content: captured as one image/media layer, never descended into. */
export const MEDIA_TAGS: ReadonlySet<string> = new Set([
  "img",
  "svg",
  "video",
  "canvas",
  "iframe",
  "embed",
  "object",
  "audio",
  "frame",
]);

/** Form controls: captured as box + text, never descended into. */
export const FORM_TAGS: ReadonlySet<string> = new Set(["input", "select", "textarea", "progress", "meter"]);
