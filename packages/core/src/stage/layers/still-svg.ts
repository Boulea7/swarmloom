/**
 * Still copies of animated SVG images. An SVG shown through `<img>` runs its SMIL and CSS
 * animations, and plays the animated images it embeds, on the browser's own clock, and its document
 * is opaque: neither the world freeze (WORLD_FREEZE_CSS) nor an export's seek reaches it, so frames
 * showing it would depend on wall time. Image layers show such a source as a still copy instead (see
 * still-image.ts): SMIL elements are removed (the authored drawing, as in the SVG adapter's static
 * skeleton), CSS animations hold their first frame and embedded images show their still copies.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
/** SMIL timing elements; an `mpath` goes with its `animateMotion`. */
const SMIL = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set", "discard"]);
const KEYFRAMES = /@(?:-[a-z]+-)?keyframes\b/i;
/** Cheap check before parsing: markup that can animate at all. */
const MAY_ANIMATE = /<(?:[\w.-]+:)?(?:animate\w*|set|discard)[\s/>]|@(?:-[a-z]+-)?keyframes\b/i;
/** Cheap checks before parsing: markup that may embed a `data:` image (an `<image>`, `<feImage>` or `<img>`). */
const MAY_EMBED = /<(?:[\w.-]+:)?(?:image|feImage|img)[\s/>]/i;
const DATA_URL = /data:/i;
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

/**
 * Markup of `text` with its animation stopped, or null when it does not animate or is not a
 * well-formed SVG document (an `<img>` would not show that either). With `embed`, the `data:` images
 * it embeds (`<image>` and `<feImage>`, and `<img>` in a `<foreignObject>`) show what `embed` answers
 * for them, an animated GIF its first frame: an SVG shown as an image loads no other URLs. The answer
 * comes through a promise (never rejecting) when one of them does.
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
  const waits: Promise<void>[] = [];
  if (embed) {
    const imgs = Array.from(root.getElementsByTagNameNS(XHTML_NS, "img"), (img) => img.getAttributeNodeNS(null, "src"));
    for (const attr of [...svgImageHrefs(root), ...imgs]) {
      const src = attr?.value.trim();
      if (!attr || !src || !/^data:/i.test(src)) continue;
      const swap = (copy: string): void => {
        if (copy === src) return;
        attr.value = copy;
        changed = true;
      };
      const still = embed(src);
      if (typeof still === "string") swap(still);
      else waits.push(still.then(swap));
    }
  }
  const markup = (): string | null => (changed ? new XMLSerializer().serializeToString(root) : null);
  return waits.length > 0 ? Promise.all(waits).then(markup) : markup();
}

export function svgDataUrl(markup: string, hash: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}${hash}`;
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
    const raw = decodeURIComponent(body);
    if (/;base64$/i.test(head[1] ?? "")) {
      const bin = atob(raw.replace(/\s+/g, ""));
      text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } else {
      text = raw;
    }
  } catch {
    return null;
  }
  const hash = end < 0 ? "" : src.slice(end);
  return after(stillSvgMarkup(text, embed), (markup) => (markup ? svgDataUrl(markup, hash) : null));
}
