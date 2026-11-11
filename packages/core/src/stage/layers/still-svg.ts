/**
 * Still copies of animated SVG images. An SVG shown through `<img>` runs its SMIL and CSS
 * animations on the browser's own clock, and its document is opaque: neither the world freeze
 * (WORLD_FREEZE_CSS) nor an export's seek reaches it, so frames showing it would depend on wall
 * time. Image layers show such a source as a still copy instead: SMIL elements are removed (the
 * authored drawing, as in the SVG adapter's static skeleton) and CSS animations hold their first
 * frame.
 *
 * The stage can only read SVG `data:` URLs, same-origin `.svg` files and same-origin `blob:` URLs
 * of SVG files (fetched once per URL). Other SVG images, such as cross-origin ones, keep their own
 * clock.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
/** SMIL timing elements; an `mpath` goes with its `animateMotion`. */
const SMIL = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set", "discard"]);
const KEYFRAMES = /@(?:-[a-z]+-)?keyframes\b/i;
/** Cheap check before parsing: markup that can animate at all. */
const MAY_ANIMATE = /<(?:[\w.-]+:)?(?:animate\w*|set|discard)[\s/>]|@(?:-[a-z]+-)?keyframes\b/i;
/** The SVG media type, with or without parameters. */
const SVG_TYPE = /^\s*image\/svg\+xml\s*(?:;|$)/i;
const PAUSE_CSS = "*,*::before,*::after{animation-play-state:paused!important;transition:none!important}";
/** Larger SVG text is shown as is (characters). */
const MAX_SVG_CHARS = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
/** Fetched files kept by absolute URL (least recently used out), so re-mounts do not fetch again. */
const CACHE_LIMIT = 32;
const fetched = new Map<string, Promise<string | null>>();

/**
 * Markup of `text` with its animation stopped, or null when it does not animate or is not a
 * well-formed SVG document (an `<img>` would not show that either).
 */
function stillSvgMarkup(text: string): string | null {
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

function svgDataUrl(markup: string, hash: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}${hash}`;
}

/** Still copy of an SVG `data:` URL; null for other URLs, still or undecodable ones. */
function stillDataUrl(src: string): string | null {
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

async function fetchStill(win: Window, url: URL): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = win.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await win.fetch(url.href, { signal: ctrl.signal, credentials: "same-origin" });
    // A blob: URL says nothing about its type in the URL; its response carries the blob's type.
    const notSvg = url.protocol === "blob:" && !SVG_TYPE.test(res.headers.get("content-type") ?? "");
    if (!res.ok || notSvg || Number(res.headers.get("content-length")) > MAX_SVG_CHARS) {
      void res.body?.cancel().catch(() => undefined);
      return null;
    }
    const markup = stillSvgMarkup(await res.text());
    return markup ? svgDataUrl(markup, url.hash) : null;
  } catch {
    // Network errors, timeouts and pages that block the request keep the file's own clock.
    return null;
  } finally {
    win.clearTimeout(timer);
  }
}

/**
 * Origin of the document shown in `win`. A srcdoc frame (the Studio's export frame) shares its
 * parent's origin, while its location (about:srcdoc) reports "null".
 */
function documentOrigin(win: Window): string {
  return typeof win.origin === "string" ? win.origin : win.location.origin;
}

/**
 * A same-origin URL that may hold an SVG file, else null: an http(s) URL whose path ends in `.svg`,
 * or a blob: URL (its type is checked once fetched).
 */
function sameOriginSvg(src: string, doc: Document): URL | null {
  const win = doc.defaultView;
  if (!win || typeof win.fetch !== "function") return null;
  try {
    const url = new URL(src, doc.baseURI);
    const origin = documentOrigin(win);
    // An opaque origin ("null") matches nothing: such a page cannot read other URLs.
    if (origin === "null" || url.origin !== origin) return null;
    if (url.protocol === "blob:") return url;
    const web = url.protocol === "http:" || url.protocol === "https:";
    return web && url.pathname.toLowerCase().endsWith(".svg") ? url : null;
  } catch {
    return null;
  }
}

/**
 * What the `<img>` of an image layer should load for `src`: `src` itself, or a still `data:` copy
 * when `src` is an animated SVG the stage can read. Same-origin `.svg` files and blob: URLs answer
 * through a promise (fetched, then cached); it never rejects and falls back to `src`.
 */
export function stillImageSource(src: string, doc: Document): string | Promise<string> {
  if (/^data:/i.test(src)) return stillDataUrl(src) ?? src;
  const url = sameOriginSvg(src, doc);
  if (!url) return src;
  const key = url.href;
  let still = fetched.get(key);
  if (still) {
    fetched.delete(key);
  } else {
    still = fetchStill(doc.defaultView as Window, url);
    if (fetched.size >= CACHE_LIMIT) fetched.delete(fetched.keys().next().value as string);
  }
  fetched.set(key, still);
  return still.then((copy) => copy ?? src);
}
