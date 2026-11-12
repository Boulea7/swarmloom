import { animatedDataUrl, firstFrameUrl, stillBitmapResponse } from "./still-bitmap";
import { MAX_SVG_CHARS, SVG_TYPE, stillSvgDataUrl, stillSvgMarkup, svgDataUrl } from "./still-svg";

/*
 * Still copies of animated images. An `<img>` plays an animated SVG (still-svg.ts) or an animated
 * GIF, APNG, WebP or AVIF (still-bitmap.ts) on the browser's own clock, out of reach of the world
 * freeze and an export's seek, so image layers (and the render page's live page) show a still copy.
 *
 * The stage can only read `data:` URLs, same-origin files (`.svg`, `.gif`, `.png`, `.apng`, `.webp`,
 * `.avif`) and same-origin `blob:` URLs. Other images, such as cross-origin ones, keep their own clock.
 */

const FETCH_TIMEOUT_MS = 5000;
/** Same-origin paths that may hold an animated image. */
const FILE_PATH = /\.(?:svg|gif|png|apng|webp|avif)$/i;
/** Still copies kept by URL (least recently used out), so re-mounts do not fetch or decode again. */
const CACHE_LIMIT = 32;
const stills = new Map<string, Promise<string | null>>();
/**
 * Fetched files that gave no still copy (most of them: still images), kept by URL alone and so in far
 * greater number (least recently used out). Re-mounts and replays of an image-heavy page show them
 * at once, without fetching them again or holding the copies' slots.
 */
const PLAIN_LIMIT = 4096;
const plain = new Set<string>();

function cached(key: string, make: () => Promise<string | null>): Promise<string | null> {
  let still = stills.get(key);
  if (still) {
    stills.delete(key);
  } else {
    still = make();
    if (stills.size >= CACHE_LIMIT) stills.delete(stills.keys().next().value as string);
  }
  stills.set(key, still);
  return still;
}

/** Whether the file at `key` gave no still copy before (and keeps that memory fresh). */
function knownPlain(key: string): boolean {
  if (!plain.delete(key)) return false;
  plain.add(key);
  return true;
}

function rememberPlain(key: string): void {
  stills.delete(key);
  if (plain.size >= PLAIN_LIMIT) plain.delete(plain.values().next().value as string);
  plain.add(key);
}

/** Still copy of the file at `url`: null when it has none, undefined when it could not be read. */
async function fetchStill(doc: Document, url: URL): Promise<string | null | undefined> {
  const win = doc.defaultView as Window;
  const ctrl = new AbortController();
  const timer = win.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // The page has most often loaded the file for its own <img> already: a cached response, stale or
    // not, spares a second round trip (a no-cache server would otherwise answer each one again).
    const res = await win.fetch(url.href, { signal: ctrl.signal, credentials: "same-origin", cache: "force-cache" });
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      return undefined;
    }
    // A blob: URL says nothing about its type in the URL; its response carries the blob's type.
    const svg =
      url.protocol === "blob:"
        ? SVG_TYPE.test(res.headers.get("content-type") ?? "")
        : url.pathname.toLowerCase().endsWith(".svg");
    if (!svg) return await stillBitmapResponse(res, doc);
    if (Number(res.headers.get("content-length")) > MAX_SVG_CHARS) {
      void res.body?.cancel().catch(() => undefined);
      return null;
    }
    const markup = stillSvgMarkup(await res.text());
    return markup ? svgDataUrl(markup, url.hash) : null;
  } catch {
    // Network errors, timeouts and pages that block the request keep the file's own clock.
    return undefined;
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
 * A same-origin URL that may hold an animated image, else null: an http(s) URL whose path ends in
 * one of the image extensions above, or a blob: URL (its type is checked once fetched).
 */
function sameOriginFile(src: string, doc: Document): URL | null {
  const win = doc.defaultView;
  if (!win || typeof win.fetch !== "function") return null;
  try {
    const url = new URL(src, doc.baseURI);
    const origin = documentOrigin(win);
    // An opaque origin ("null") matches nothing: such a page cannot read other URLs.
    if (origin === "null" || url.origin !== origin) return null;
    if (url.protocol === "blob:") return url;
    const web = url.protocol === "http:" || url.protocol === "https:";
    return web && FILE_PATH.test(url.pathname) ? url : null;
  } catch {
    return null;
  }
}

/**
 * What an `<img>` should load for `src`: `src` itself, or a still `data:` copy when `src` is an
 * animated image the stage can read. An SVG `data:` URL answers at once; animated bitmap `data:`
 * URLs, same-origin files and blob: URLs answer through a promise (decoded or fetched once, then
 * cached), which never rejects and falls back to `src`. A file that gave no copy before answers `src`
 * at once. `doc` fetches and draws the copies.
 */
export function stillImageSource(src: string, doc: Document): string | Promise<string> {
  let still: Promise<string | null>;
  if (/^data:image\/svg\+xml[;,]/i.test(src)) return stillSvgDataUrl(src) ?? src;
  if (/^data:/i.test(src)) {
    // A cached copy spares decoding the file again.
    const bitmap = stills.has(src) ? undefined : animatedDataUrl(src);
    if (bitmap === null) return src;
    still = cached(src, () => (bitmap ? firstFrameUrl(bitmap.bytes, bitmap.type, doc) : Promise.resolve(null)));
  } else {
    const url = sameOriginFile(src, doc);
    if (!url || knownPlain(url.href)) return src;
    const key = url.href;
    still = cached(key, () =>
      fetchStill(doc, url).then((copy) => {
        // A file that failed to load (not one read and found still) is tried again once evicted.
        if (copy === null) rememberPlain(key);
        return copy ?? null;
      }),
    );
  }
  return still.then((copy) => copy ?? src);
}

/**
 * Points `img` at `src` through {@link stillImageSource}: a copy known at once is set right away;
 * otherwise `src` shows until the copy is ready, then the copy, unless `gone()` says the view was
 * dropped meanwhile. Returns that pending swap (it never rejects), or null when there is none.
 */
export function showStill(
  img: HTMLImageElement,
  src: string,
  doc: Document,
  gone: () => boolean,
): Promise<void> | null {
  const set = (value: string): void => {
    // Assigning the value it already has would start the load again.
    if (img.getAttribute("src") !== value) img.src = value;
  };
  const source = stillImageSource(src, doc);
  if (typeof source === "string") {
    set(source);
    return null;
  }
  set(src);
  return source.then((copy) => {
    if (!gone()) set(copy);
  });
}
