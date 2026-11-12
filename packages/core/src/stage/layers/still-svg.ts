/**
 * Still copies of animated SVG images. An SVG shown through `<img>` runs its SMIL and CSS
 * animations, and plays the animated images it embeds, on the browser's own clock, and its document
 * is opaque: neither the world freeze (WORLD_FREEZE_CSS) nor an export's seek reaches it, so frames
 * showing it would depend on wall time. Image layers show such a source as a still copy instead (see
 * still-image.ts): SMIL elements are removed (the authored drawing, as in the SVG adapter's static
 * skeleton), CSS animations hold their first frame and embedded images show their still copies.
 */

import { cssUrl, URL_TOKEN, urlOf } from "./css-url";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
/** SMIL timing elements; an `mpath` goes with its `animateMotion`. */
const SMIL = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set", "discard"]);
const KEYFRAMES = /@(?:-[a-z]+-)?keyframes\b/i;
/** Cheap check before parsing: markup that can animate at all. */
const MAY_ANIMATE = /<(?:[\w.-]+:)?(?:animate\w*|set|discard)[\s/>]|@(?:-[a-z]+-)?keyframes\b/i;
/**
 * Cheap checks before parsing: markup that may embed a `data:` image (an `<image>`, `<feImage>` or
 * `<img>`, or a CSS url() in a style sheet or `style` attribute, its quote maybe written as an entity).
 */
const MAY_EMBED = /<(?:[\w.-]+:)?(?:image|feImage|img)[\s/>]|url\(\s*(?:["']|&[\w#]+;)?\s*data:/i;
const DATA_URL = /data:/i;
const TEXT_NODE = 3;
const CDATA_NODE = 4;
/** The SVG media type, with or without parameters. */
export const SVG_TYPE = /^\s*image\/svg\+xml\s*(?:;|$)/i;
const PAUSE_CSS = "*,*::before,*::after{animation-play-state:paused!important;transition:none!important}";
/** Larger SVG text is shown as is (characters). */
export const MAX_SVG_CHARS = 2 * 1024 * 1024;

/**
 * What an embedded image should show (still-image.ts's stillImageSource): its URL itself, or a
 * still copy, at once or through a promise that never rejects.
 */
export type StillEmbed = (src: string) => string | Promise<string>;

/** Either a value or a promise of it, as {@link stillSvgMarkup} answers. */
type Maybe<T> = T | Promise<T>;

function after<T, U>(value: Maybe<T>, next: (value: T) => U): Maybe<U> {
  return value instanceof Promise ? value.then(next) : next(value);
}

/**
 * The `href` and `xlink:href` attributes of the SVG `<image>` and `<feImage>` elements under `root`:
 * the images an SVG drawing embeds by URL (an `<feImage>` may also name an element by fragment).
 */
export function svgImageHrefs(root: Document | Element): Attr[] {
  const out: Attr[] = [];
  for (const name of ["image", "feImage"]) {
    for (const el of Array.from(root.getElementsByTagNameNS(SVG_NS, name))) {
      for (const attr of [el.getAttributeNodeNS(null, "href"), el.getAttributeNodeNS(XLINK_NS, "href")]) {
        if (attr) out.push(attr);
      }
    }
  }
  return out;
}

/** A node naming embedded images: a URL attribute, or CSS text (`css`) whose url()s may name some. */
type EmbedSlot = { node: Attr | Text; css: boolean };

/**
 * Where an SVG document names the images it embeds: URL attributes (`<image>` and `<feImage>`, and
 * `<img>` in a `<foreignObject>`), and CSS text whose url()s may name images (the `style` attribute
 * of any element, and `<style>` sheets, SVG or XHTML; a text node or CDATA section each).
 */
function embedSlots(root: Element): EmbedSlot[] {
  const imgs = Array.from(root.getElementsByTagNameNS(XHTML_NS, "img"), (img) => img.getAttributeNodeNS(null, "src"));
  const slots: EmbedSlot[] = [...svgImageHrefs(root), ...imgs].flatMap((node) => (node ? [{ node, css: false }] : []));
  for (const el of [root, ...Array.from(root.getElementsByTagName("*"))]) {
    const style = el.getAttributeNodeNS(null, "style");
    if (style) slots.push({ node: style, css: true });
    if (el.localName !== "style" || (el.namespaceURI !== SVG_NS && el.namespaceURI !== XHTML_NS)) continue;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE) slots.push({ node: child as Text, css: true });
    }
  }
  return slots;
}

/** The URLs a slot of {@link embedSlots} names: its value, or the url()s of its CSS text. */
function slotUrls(value: string, css: boolean): string[] {
  if (!css) return [value.trim()];
  return value.includes("url(") ? Array.from(value.matchAll(URL_TOKEN), (m) => urlOf(m[1], m[2], m[3]).trim()) : [];
}

/** `value` of a slot of {@link embedSlots} with its URLs swapped through `copyOf` (undefined: kept). */
function swapUrls(value: string, css: boolean, copyOf: (src: string) => string | undefined): string {
  if (!css) return copyOf(value.trim()) ?? value;
  if (!value.includes("url(")) return value;
  return value.replace(URL_TOKEN, (all, dq?: string, sq?: string, bare?: string) => {
    const copy = copyOf(urlOf(dq, sq, bare).trim());
    return copy === undefined ? all : cssUrl(copy);
  });
}

/**
 * Markup of `text` with its animation stopped, or null when it does not animate or is not a
 * well-formed SVG document (an `<img>` would not show that either). With `embed`, the `data:` images
 * it embeds (see {@link embedSlots}: `<image>`, `<feImage>`, `<img>` in a `<foreignObject>` and CSS
 * url()s, such as a background) show what `embed` answers for them, an animated GIF its first frame:
 * an SVG shown as an image loads no other URLs. The answer comes through a promise (never rejecting)
 * when one of them does.
 */
export function stillSvgMarkup(text: string, embed?: StillEmbed): Maybe<string | null> {
  if (text.length > MAX_SVG_CHARS || typeof DOMParser === "undefined") return null;
  if (!MAY_ANIMATE.test(text) && !(embed && MAY_EMBED.test(text) && DATA_URL.test(text))) return null;
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = parsed.documentElement;
  if (root?.localName !== "svg" || root.namespaceURI !== SVG_NS || parsed.getElementsByTagName("parsererror").length) {
    return null;
  }
  let changed = false;
  for (const el of Array.from(root.getElementsByTagNameNS(SVG_NS, "*"))) {
    if (SMIL.has(el.localName)) {
      el.remove();
      changed = true;
    }
  }
  if (KEYFRAMES.test(text)) {
    const style = parsed.createElementNS(SVG_NS, "style");
    style.textContent = PAUSE_CSS;
    root.append(style);
    changed = true;
  }
  const slots = embed ? embedSlots(root) : [];
  // Each `data:` URL named, by what it shows (itself until its copy is known).
  const copies = new Map<string, string>();
  const waits: Promise<void>[] = [];
  for (const { node, css } of slots) {
    for (const src of slotUrls(node.nodeValue ?? "", css)) {
      if (!embed || copies.has(src) || !/^data:/i.test(src)) continue;
      const still = embed(src);
      copies.set(src, typeof still === "string" ? still : src);
      if (typeof still !== "string") waits.push(still.then((copy) => void copies.set(src, copy)));
    }
  }
  const copyOf = (src: string): string | undefined => {
    const copy = copies.get(src);
    return copy === src ? undefined : copy;
  };
  const markup = (): string | null => {
    for (const { node, css } of slots) {
      const value = node.nodeValue ?? "";
      const next = swapUrls(value, css, copyOf);
      if (next === value) continue;
      node.nodeValue = next;
      changed = true;
    }
    return changed ? new XMLSerializer().serializeToString(root) : null;
  };
  return waits.length > 0 ? Promise.all(waits).then(markup) : markup();
}

export function svgDataUrl(markup: string, hash: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}${hash}`;
}

/**
 * Text of a `data:` URL body as browsers read it: percent escapes decoded to bytes (a `%` that starts
 * none kept as is, as in an unescaped width='100%'), then base64 when `base64`, then the bytes read as
 * UTF-8 (a stray byte as U+FFFD). Throws on malformed base64.
 */
function dataText(body: string, base64: boolean): string {
  if (!base64) {
    try {
      // The usual, strictly escaped body, decoded natively.
      return decodeURIComponent(body);
    } catch {
      // A literal `%` or an escape that is no UTF-8: decoded byte by byte below.
    }
  }
  let bin = body
    .replace(/[^\0-\x7f]+/g, encodeURIComponent)
    .replace(/%([0-9a-f]{2})/gi, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  if (base64) bin = atob(bin.replace(/\s+/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * Still copy of an SVG `data:` URL; null for other URLs, still or undecodable ones. Through a promise
 * when `embed` answers one (see {@link stillSvgMarkup}).
 */
export function stillSvgDataUrl(src: string, embed?: StillEmbed): Maybe<string | null> {
  const head = /^data:image\/svg\+xml(;[^,]*)?,/i.exec(src);
  if (!head) return null;
  const end = src.indexOf("#", head[0].length);
  const body = src.slice(head[0].length, end < 0 ? undefined : end);
  let text: string;
  try {
    text = dataText(body, /;base64$/i.test(head[1] ?? ""));
  } catch {
    return null;
  }
  const hash = end < 0 ? "" : src.slice(end);
  return after(stillSvgMarkup(text, embed), (markup) => (markup ? svgDataUrl(markup, hash) : null));
}
