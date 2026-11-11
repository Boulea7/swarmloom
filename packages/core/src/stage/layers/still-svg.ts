/**
 * Still copies of animated SVG images. An SVG shown through `<img>` runs its SMIL and CSS
 * animations on the browser's own clock, and its document is opaque: neither the world freeze
 * (WORLD_FREEZE_CSS) nor an export's seek reaches it, so frames showing it would depend on wall
 * time. Image layers show such a source as a still copy instead (see still-image.ts): SMIL elements
 * are removed (the authored drawing, as in the SVG adapter's static skeleton) and CSS animations
 * hold their first frame.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
/** SMIL timing elements; an `mpath` goes with its `animateMotion`. */
const SMIL = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set", "discard"]);
const KEYFRAMES = /@(?:-[a-z]+-)?keyframes\b/i;
/** Cheap check before parsing: markup that can animate at all. */
const MAY_ANIMATE = /<(?:[\w.-]+:)?(?:animate\w*|set|discard)[\s/>]|@(?:-[a-z]+-)?keyframes\b/i;
/** The SVG media type, with or without parameters. */
export const SVG_TYPE = /^\s*image\/svg\+xml\s*(?:;|$)/i;
const PAUSE_CSS = "*,*::before,*::after{animation-play-state:paused!important;transition:none!important}";
/** Larger SVG text is shown as is (characters). */
export const MAX_SVG_CHARS = 2 * 1024 * 1024;

/**
 * Markup of `text` with its animation stopped, or null when it does not animate or is not a
 * well-formed SVG document (an `<img>` would not show that either).
 */
export function stillSvgMarkup(text: string): string | null {
  if (text.length > MAX_SVG_CHARS || !MAY_ANIMATE.test(text) || typeof DOMParser === "undefined") return null;
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
  return changed ? new XMLSerializer().serializeToString(root) : null;
}

export function svgDataUrl(markup: string, hash: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}${hash}`;
}

/** Still copy of an SVG `data:` URL; null for other URLs, still or undecodable ones. */
export function stillSvgDataUrl(src: string): string | null {
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
  const markup = stillSvgMarkup(text);
  return markup ? svgDataUrl(markup, end < 0 ? "" : src.slice(end)) : null;
}
