import { cssString, familiesOf, fontFaceRule, fontFaceRules, type WatchedFace } from "./fonts";
import { BLANK_IMAGE, bytesToDataUrl, type ResourceCache } from "./resources";
import { type InheritedValues, type StyleBaseline, styleText } from "./styles";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** HTML elements that draw nothing themselves. */
const SKIP_HTML = new Set([
  "script",
  "style",
  "link",
  "meta",
  "template",
  "noscript",
  "head",
  "title",
  "base",
  "source",
  "track",
  "audio",
  "object",
  "embed",
]);
/** SMIL elements: dropped, the snapshot keeps the animated values they produced. */
const SMIL = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set", "discard"]);
/** Attributes that never reach the snapshot: styling is rewritten, loading hints do not apply. */
const DROP_ATTRS = new Set([
  "style",
  "class",
  "srcset",
  "sizes",
  "loading",
  "decoding",
  "fetchpriority",
  "crossorigin",
  "referrerpolicy",
  "contenteditable",
  "tabindex",
  "inert",
  "popover",
  "hidden",
  "autofocus",
  "draggable",
  "nonce",
]);
const XML_NAME = /^[A-Za-z_][\w.-]*$/;
/** Characters XML 1.0 does not allow, and unpaired surrogates. */
const INVALID_XML =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: these are exactly the characters XML 1.0 forbids.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const CSS_URL = /url\("((?:[^"\\]|\\.)*)"\)/g;
/** Marks a resource URL in the markup until its data URL is known (private-use characters survive escaping). */
const TOKEN = /\uE000(\d+)\uE001/g;
/** HTML elements without content, so without `::before`/`::after` boxes worth reading. */
const VOID = new Set(["img", "input", "br", "hr", "wbr", "area", "col", "select", "textarea"]);

function escapeText(text: string): string {
  return text.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text)
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;");
}

/** Where the snapshot reads from. */
export interface SnapshotSource {
  document: Document;
  /** Viewport size, CSS px. */
  width: number;
  height: number;
  /** Shadow root of a host, closed ones included (watched while the stage was built). */
  shadowRootOf(host: Element): ShadowRoot | null;
  /** Shadow roots whose style sheets may declare fonts. */
  shadowRoots(): Iterable<ShadowRoot>;
  /** Faces created through the FontFace API. */
  faces(): readonly WatchedFace[];
}

/** What one snapshot found worth reporting. */
export interface SnapshotStats {
  elements: number;
  /** Absolutely positioned subtrees left out because they lie outside the viewport or are transparent. */
  culled: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Walk {
  baseline: StyleBaseline;
  resources: ResourceCache;
  shadowRootOf: (host: Element) => ShadowRoot | null;
  out: string[];
  rules: string[];
  families: Set<string>;
  /** URLs waiting for their data URL, by token index. */
  urls: { url: string; fallback?: () => string | null }[];
  stats: SnapshotStats;
  nextClass: number;
}

/** Per-frame state of one document (the frame itself or the live page inside it). */
interface DocView {
  win: Window & typeof globalThis;
  viewport: Box;
}

/** Replaces each resource URL with a data URL, or a token resolved after the walk. */
function embedUrl(walk: Walk, url: string, fallback?: () => string | null): string {
  if (!url || url.startsWith("#")) return url;
  const known = walk.resources.peek(url);
  if (known !== undefined) return known;
  walk.urls.push({ url, fallback });
  return `\uE000${walk.urls.length - 1}\uE001`;
}

function embedCssUrls(walk: Walk, value: string): string {
  if (!value.includes("url(")) return value;
  return value.replace(CSS_URL, (match, raw: string) => {
    const url = raw.replace(/\\(.)/g, "$1");
    if (url.startsWith("#") || url.startsWith("data:")) return match;
    return `url("${embedUrl(walk, url)}")`;
  });
}

function intersects(a: Box, b: DOMRect): boolean {
  return b.right > a.left && b.left < a.right && b.bottom > a.top && b.top < a.bottom;
}

/**
 * An absolutely positioned subtree that cannot show: fully transparent, or clipped to a box that
 * lies outside the viewport. Leaving it out cannot move anything else (it is out of flow).
 */
function culled(el: Element, cs: CSSStyleDeclaration, view: DocView): boolean {
  const position = cs.getPropertyValue("position");
  if (position !== "absolute" && position !== "fixed") return false;
  if (cs.getPropertyValue("opacity") === "0") return true;
  const clipped = cs.getPropertyValue("overflow-x") !== "visible" && cs.getPropertyValue("overflow-y") !== "visible";
  return clipped && !intersects(view.viewport, el.getBoundingClientRect());
}

/** `translate` value that adds an offset to the element's own `translate`. */
function shiftedTranslate(current: string, dx: number, dy: number): string {
  const parts = current === "none" ? [] : current.split(/\s+/);
  const x = Number.parseFloat(parts[0] ?? "0") || 0;
  const y = Number.parseFloat(parts[1] ?? "0") || 0;
  const z = parts[2] ? ` ${parts[2]}` : "";
  return `${x + dx}px ${y + dy}px${z}`;
}

function canvasDataUrl(canvas: HTMLCanvasElement): string {
  try {
    return canvas.width > 0 && canvas.height > 0 ? canvas.toDataURL("image/png") : BLANK_IMAGE;
  } catch {
    return BLANK_IMAGE;
  }
}

/** Draws the current frame of a video into a PNG data URL (blank when it has none or is cross-origin). */
function videoDataUrl(video: HTMLVideoElement): string {
  if (video.readyState < 2 || video.videoWidth === 0) return BLANK_IMAGE;
  const canvas = video.ownerDocument.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  return canvasDataUrl(canvas);
}

/** Draws a loaded image into a PNG data URL; used when its URL cannot be fetched. */
function imageFallback(img: HTMLImageElement): () => string | null {
  return () => {
    if (!img.complete || img.naturalWidth === 0) return null;
    const canvas = img.ownerDocument.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  };
}

/** Attributes of a clone, with resource URLs embedded and live form state written back. */
function attributes(walk: Walk, el: Element): string {
  const out: string[] = [];
  const svg = el.namespaceURI === SVG_NS;
  const local = el.localName;
  for (const attr of Array.from(el.attributes)) {
    let name = attr.name;
    if (attr.namespaceURI === XLINK_NS && attr.localName === "href") name = "href";
    else if (attr.namespaceURI === XML_NS) name = `xml:${attr.localName}`;
    else if (attr.namespaceURI || !XML_NAME.test(name)) continue;
    if (DROP_ATTRS.has(name) || name.startsWith("on") || name === "xmlns") continue;
    let value = attr.value;
    if (name === "src" && (local === "img" || local === "iframe" || local === "video")) continue;
    if (svg && name === "href" && local === "image") value = embedUrl(walk, value);
    out.push(` ${name}="${escapeAttr(value)}"`);
  }
  if (local === "input" && !svg) {
    const input = el as HTMLInputElement;
    if (input.type !== "file" && input.type !== "password") out.push(` value="${escapeAttr(input.value)}"`);
    if (input.checked) out.push(' checked="checked"');
  }
  if (local === "option" && !svg && (el as HTMLOptionElement).selected) out.push(' selected="selected"');
  return out.join("");
}

/** Children in the flattened tree: the shadow tree of a host, the assigned nodes of a slot. */
function flatChildren(walk: Walk, el: Element): readonly Node[] {
  const root = walk.shadowRootOf(el);
  if (root) return Array.from(root.childNodes);
  if (el.localName === "slot" && el.namespaceURI === XHTML_NS) {
    const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
    if (assigned.length > 0) return assigned;
  }
  return Array.from(el.childNodes);
}

/** `::before` / `::after` of `el` as a rule on a class of the clone, or null when it has none. */
function pseudoRules(walk: Walk, el: Element, view: DocView, inherited: InheritedValues): string | null {
  let cls: string | null = null;
  for (const pseudo of ["::before", "::after"] as const) {
    const ps = view.win.getComputedStyle(el, pseudo);
    const content = ps.getPropertyValue("content");
    if (!content || content === "none" || content === "normal") continue;
    cls ??= `sl${walk.nextClass++}`;
    const { text } = styleText(walk.baseline, ps, inherited);
    for (const family of familiesOf(ps.getPropertyValue("font-family"))) walk.families.add(family);
    walk.rules.push(`.${cls}${pseudo}{${embedCssUrls(walk, text)};content:${embedCssUrls(walk, content)}}`);
  }
  return cls;
}

/** Emits a text node, shifted when its parent is a scrolled container. */
function emitText(walk: Walk, node: Node, shift: { x: number; y: number } | null): void {
  const text = escapeText(node.nodeValue ?? "");
  if (!text) return;
  if (shift) walk.out.push(`<span style="position:relative;left:${shift.x}px;top:${shift.y}px">${text}</span>`);
  else walk.out.push(text);
}

/** Emits one element and its flattened subtree. */
function emitElement(
  walk: Walk,
  el: Element,
  view: DocView,
  parent: InheritedValues | null,
  parentNs: string,
  shift: { x: number; y: number } | null,
): void {
  const ns = el.namespaceURI ?? XHTML_NS;
  const local = el.localName;
  const svg = ns === SVG_NS;
  if (ns === XHTML_NS && SKIP_HTML.has(local)) return;
  if (svg && SMIL.has(local)) return;
  const cs = view.win.getComputedStyle(el);
  // SVG resources (gradients, symbols) count even inside display:none, so only HTML subtrees go.
  if (!svg && cs.getPropertyValue("display") === "none") return;
  if (!svg && culled(el, cs, view)) {
    walk.stats.culled++;
    return;
  }
  walk.stats.elements++;

  const override: Record<string, string> = {};
  const overflowX = cs.getPropertyValue("overflow-x");
  const overflowY = cs.getPropertyValue("overflow-y");
  // No scrollbars in a still frame; scroll offsets become a shift of the children.
  if (overflowX === "auto" || overflowX === "scroll") override["overflow-x"] = "hidden";
  if (overflowY === "auto" || overflowY === "scroll") override["overflow-y"] = "hidden";
  if (shift) override.translate = shiftedTranslate(cs.getPropertyValue("translate"), shift.x, shift.y);
  const frame = local === "iframe" && !svg;
  if (frame) {
    // The frame's document is drawn into a box that must size and contain it like the frame did.
    override["overflow-x"] = "hidden";
    override["overflow-y"] = "hidden";
    if (cs.getPropertyValue("display") === "inline") override.display = "inline-block";
    if (cs.getPropertyValue("position") === "static") override.position = "relative";
  }
  const { text: styleBody, inherited } = styleText(walk.baseline, cs, parent, override);
  for (const family of familiesOf(cs.getPropertyValue("font-family"))) walk.families.add(family);

  let tag = svg || ns !== XHTML_NS ? local : local === "html" || local === "body" ? "div" : local;
  if (!XML_NAME.test(tag)) tag = "span";
  const replaced = !svg && (local === "canvas" || local === "video" || local === "iframe");
  if (replaced && local !== "iframe") tag = "img";
  const xmlns = ns !== parentNs ? ` xmlns="${ns}"` : "";
  const pseudo = svg || replaced || VOID.has(local) ? null : pseudoRules(walk, el, view, inherited);
  const cls = pseudo ? ` class="${pseudo}"` : "";
  const style = styleBody ? ` style="${escapeAttr(embedCssUrls(walk, styleBody))}"` : "";
  let attrs = attributes(walk, el);
  if (!svg && local === "img") {
    const img = el as HTMLImageElement;
    const src = img.currentSrc || img.src;
    attrs += ` src="${src ? escapeAttr(embedUrl(walk, src, imageFallback(img))) : BLANK_IMAGE}"`;
  } else if (local === "canvas" && !svg) {
    attrs = ` src="${canvasDataUrl(el as HTMLCanvasElement)}"`;
  } else if (local === "video" && !svg) {
    attrs = ` src="${videoDataUrl(el as HTMLVideoElement)}"`;
  }

  if (frame) {
    walk.out.push(`<div${xmlns}${style}>`);
    emitFrame(walk, el as HTMLIFrameElement, cs);
    walk.out.push("</div>");
    return;
  }
  if (tag === "img") {
    walk.out.push(`<img${xmlns}${attrs}${cls}${style}/>`);
    return;
  }
  walk.out.push(`<${tag}${xmlns}${attrs}${cls}${style}>`);
  if (local === "textarea" && !svg) {
    walk.out.push(escapeText((el as HTMLTextAreaElement).value));
  } else {
    const scrolled = el.scrollLeft !== 0 || el.scrollTop !== 0;
    const childShift = scrolled ? { x: -el.scrollLeft, y: -el.scrollTop } : null;
    for (const child of flatChildren(walk, el)) {
      if (child.nodeType === 1) emitElement(walk, child as Element, view, inherited, ns, childShift);
      else if (child.nodeType === 3 || child.nodeType === 4) emitText(walk, child, childShift);
    }
  }
  walk.out.push(`</${tag}>`);
}

/** The document of a same-origin frame drawn into its box, at its scroll position. */
function emitFrame(walk: Walk, frame: HTMLIFrameElement, cs: CSSStyleDeclaration): void {
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    doc = null;
  }
  const win = doc?.defaultView as (Window & typeof globalThis) | null | undefined;
  if (!doc?.documentElement || !win) return;
  const width = frame.clientWidth;
  const height = frame.clientHeight;
  const at = {
    x: Number.parseFloat(cs.getPropertyValue("padding-left")) || 0,
    y: Number.parseFloat(cs.getPropertyValue("padding-top")) || 0,
  };
  emitDocument(walk, { win, viewport: { left: 0, top: 0, right: width, bottom: height } }, width, height, at);
}

/** Canvas background of a document: the root's, else the body's, else white. */
function canvasBackground(doc: Document, win: Window): string {
  const transparent = (c: string) => c === "transparent" || c === "rgba(0, 0, 0, 0)";
  const root = win.getComputedStyle(doc.documentElement).getPropertyValue("background-color");
  if (!transparent(root)) return root;
  const body = doc.body ? win.getComputedStyle(doc.body).getPropertyValue("background-color") : "";
  return body && !transparent(body) ? body : "#fff";
}

/** A document's viewport: a clipping box at `at` with the canvas background, the root inside it. */
function emitDocument(
  walk: Walk,
  view: DocView,
  width: number,
  height: number,
  at: { x: number; y: number } = { x: 0, y: 0 },
): void {
  const doc = view.win.document;
  const bg = canvasBackground(doc, view.win);
  walk.out.push(
    `<div style="display:block;position:absolute;left:${at.x}px;top:${at.y}px;overflow:hidden;` +
      `width:${width}px;height:${height}px;background:${escapeAttr(bg)}">`,
  );
  const x = -view.win.scrollX;
  const y = -view.win.scrollY;
  const shift = x !== 0 || y !== 0 ? { x, y } : null;
  emitElement(walk, doc.documentElement, view, null, XHTML_NS, shift);
  walk.out.push("</div>");
}

/** `@font-face` rules the frame uses, with their sources embedded. */
async function fontCss(walk: Walk, source: SnapshotSource, docs: readonly Document[]): Promise<string> {
  const rules: string[] = [];
  const used = (family: string) => walk.families.has(family.replace(/^["']|["']$/g, "").toLowerCase());
  const sheets: CSSStyleSheet[] = [];
  for (const doc of docs) {
    sheets.push(...Array.from(doc.styleSheets), ...doc.adoptedStyleSheets);
  }
  for (const root of source.shadowRoots()) sheets.push(...Array.from(root.styleSheets), ...root.adoptedStyleSheets);
  const win = source.document.defaultView;
  for (const sheet of sheets) {
    // Sheets that do not apply (disabled, or for other media) declare no fonts for this frame.
    const media = sheet.media.mediaText;
    if (sheet.disabled || (media && win && !win.matchMedia(media).matches)) continue;
    for (const rule of fontFaceRules(sheet)) {
      if (used(rule.style.getPropertyValue("font-family"))) rules.push(embedCssUrls(walk, rule.cssText));
    }
  }
  for (const face of source.faces()) {
    if (!used(face.family)) continue;
    if (typeof face.source === "string") {
      const src = face.source.replace(/url\((['"]?)([^'")]+)\1\)/g, (_m, _q, url: string) =>
        url.startsWith("data:") ? `url(${cssString(url)})` : `url("${embedUrl(walk, url)}")`,
      );
      rules.push(fontFaceRule(face, src));
    } else {
      rules.push(fontFaceRule(face, `url(${cssString(await bytesToDataUrl(face.source, "font/ttf"))})`));
    }
  }
  return rules.join("\n");
}

/** Style sheet of the snapshot: the reset every clone starts from, pseudo-elements and fonts. */
function sheet(rules: readonly string[], fonts: string): string {
  // Only the clones inside the foreignObject: resetting the wrapping `<svg>` and `<foreignObject>`
  // would turn their width and height (geometry properties) to `auto`, and Firefox then draws
  // nothing of the foreignObject.
  const css = `${fonts}\nforeignObject *{all:unset}\nstyle{display:none!important}\n${rules.join("\n")}`;
  return `<style><![CDATA[${css.replace(/]]>/g, "]]]]><![CDATA[>")}]]></style>`;
}

/**
 * Serialises what the frame document shows into one SVG image: the flattened tree (shadow roots,
 * slots, same-origin frames) as XHTML in a `foreignObject`, every clone reset with `all: unset`
 * and given back the computed values that differ, and every resource (images, canvases, fonts)
 * embedded as a data URL, since an SVG image loads nothing else.
 *
 * Known limits: pseudo-elements other than `::before`/`::after` (custom `::marker`,
 * `::first-letter`) fall back to defaults; cross-origin images without CORS are left blank;
 * WebGL canvases show what `toDataURL` returns at capture time; `position: sticky` does not stick.
 */
export async function snapshotFrame(
  source: SnapshotSource,
  baseline: StyleBaseline,
  resources: ResourceCache,
): Promise<{ svg: string; stats: SnapshotStats }> {
  const doc = source.document;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win) throw new Error("The frame document has no window");
  const walk: Walk = {
    baseline,
    resources,
    shadowRootOf: source.shadowRootOf,
    out: [],
    rules: [],
    families: new Set(),
    urls: [],
    stats: { elements: 0, culled: 0 },
    nextClass: 0,
  };
  const { width, height } = source;
  walk.out.push(
    `<div xmlns="${XHTML_NS}" style="display:block;position:relative;width:${width}px;height:${height}px;overflow:hidden">`,
  );
  const bodyAt = walk.out.length;
  emitDocument(walk, { win, viewport: { left: 0, top: 0, right: width, bottom: height } }, width, height);
  const docs = [doc];
  for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) docs.push(frame.contentDocument);
    } catch {
      // Cross-origin frames are drawn empty.
    }
  }
  const fonts = await fontCss(walk, source, docs);
  walk.out.splice(bodyAt, 0, sheet(walk.rules, fonts));
  walk.out.push("</div>");
  let markup = walk.out.join("");
  if (walk.urls.length > 0) {
    const data = await Promise.all(walk.urls.map(({ url, fallback }) => resources.resolve(url, fallback)));
    // Data URLs from the cache are base64, so they are safe in attributes and in CSS strings alike.
    markup = markup.replace(TOKEN, (_m, index: string) => data[Number(index)] ?? BLANK_IMAGE);
  }
  const svg =
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`;
  return { svg, stats: walk.stats };
}
