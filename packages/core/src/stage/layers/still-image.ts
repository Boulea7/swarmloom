import { animatedDataUrl, firstFrameUrl, stillBitmapResponse } from "./still-bitmap";
import {
  MAX_SVG_CHARS,
  type StillEmbed,
  SVG_TYPE,
  stillSvgDataUrl,
  stillSvgMarkup,
  svgDataUrl,
  svgImageHrefs,
} from "./still-svg";

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
/**
 * Still copies made through a promise (animated bitmaps, SVGs that embed one, fetched files), kept
 * by URL (least recently used out), so re-mounts, replays and seeks back neither fetch nor decode
 * again. Bounded by the characters of the keys and copies (a `data:` URL is its own key), not by
 * count: a replay mounts a page's images in the same order every time, so a cache holding fewer
 * than the page shows misses every one of them.
 */
const STILL_CHARS = 64 * 1024 * 1024;
interface Still {
  readonly copy: Promise<string | null>;
  chars: number;
}
const stills = new Map<string, Still>();
let stillChars = 0;
/**
 * Answers known at once, kept by URL (least recently used out), so re-mounts, replays and seeks back
 * neither fetch nor decode again, nor hold the copies' slots: null for a fetched file found still or
 * a `data:` URL with no still copy (most images show as they are), or the copy of an SVG `data:` URL
 * made without waiting. A `data:` URL is its own key, the blueprint's string, which may run to
 * megabytes, so the characters kept are bounded too: about all the images an HTML capture inlines
 * (48 MiB, as base64).
 */
const KNOWN_LIMIT = 4096;
const KNOWN_CHARS = 64 * 1024 * 1024;
const known = new Map<string, string | null>();
let knownChars = 0;
/**
 * Stages alive. Both memories hold the blueprint's `data:` URLs and the copies made from them, so
 * they are dropped once the last stage is destroyed (see {@link retainStills}).
 */
let holders = 0;

function dropStill(key: string): void {
  const still = stills.get(key);
  if (!still) return;
  stills.delete(key);
  stillChars -= still.chars;
}

/** Counts `chars` more for `still`, then lets the least recently used copies go past the bound. */
function growStill(still: Still, chars: number): void {
  still.chars += chars;
  stillChars += chars;
  // The newest copy stays, however large.
  while (stillChars > STILL_CHARS && stills.size > 1) dropStill(stills.keys().next().value as string);
}

function cached(key: string, make: () => Promise<string | null>): Promise<string | null> {
  const hit = stills.get(key);
  if (hit) {
    stills.delete(key);
    stills.set(key, hit);
    return hit.copy;
  }
  const still: Still = { copy: make(), chars: 0 };
  stills.set(key, still);
  growStill(still, key.length);
  void still.copy.then(
    (copy) => {
      if (copy && stills.get(key) === still) growStill(still, copy.length);
    },
    () => undefined,
  );
  return still.copy;
}

/**
 * Keeps the still copies while the caller (a stage) lives. Returns its release: once every holder
 * released and none came back by the next task (a player rebuilt in place takes over the copies),
 * the copies and answers are dropped, so a destroyed player leaves neither its `data:` URLs nor
 * their copies behind.
 */
export function retainStills(): () => void {
  holders++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--holders > 0) return;
    setTimeout(() => {
      if (holders > 0) return;
      stills.clear();
      stillChars = 0;
      known.clear();
      knownChars = 0;
    }, 0);
  };
}

/** What `key` answered at once before (keeping that memory fresh), or undefined when it is not known. */
function recall(key: string): string | null | undefined {
  const answer = known.get(key);
  if (answer !== undefined) {
    known.delete(key);
    known.set(key, answer);
  }
  return answer;
}

function forget(key: string): void {
  const answer = known.get(key);
  if (answer === undefined) return;
  known.delete(key);
  knownChars -= key.length + (answer?.length ?? 0);
}

/** Keeps `answer` for `key` (see {@link known}) and returns it. */
function remember(key: string, answer: string | null): string | null {
  dropStill(key);
  forget(key);
  const chars = key.length + (answer?.length ?? 0);
  if (chars > KNOWN_CHARS) return answer;
  while (known.size > 0 && (known.size >= KNOWN_LIMIT || knownChars + chars > KNOWN_CHARS)) {
    forget(known.keys().next().value as string);
  }
  known.set(key, answer);
  knownChars += chars;
  return answer;
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
    const markup = await stillSvgMarkup(await res.text(), embedded(doc));
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

/** Still copy of a `data:` URL, null when it has none, through a promise when one is decoded. */
function dataStill(src: string, doc: Document): string | null | Promise<string | null> {
  if (/^data:image\/svg\+xml[;,]/i.test(src)) return stillSvgDataUrl(src, embedded(doc));
  const bitmap = animatedDataUrl(src);
  return bitmap && firstFrameUrl(bitmap.bytes, bitmap.type, doc);
}

/**
 * What an `<img>` should load for `src`: `src` itself, or a still `data:` copy when `src` is an
 * animated image the stage can read. An SVG `data:` URL answers at once, unless it embeds an
 * animated bitmap; such SVGs, animated bitmap `data:` URLs, same-origin files and blob: URLs answer
 * through a promise (decoded or fetched once, then cached), which never rejects and falls back to
 * `src`. A `data:` URL answered at once before, or a file that gave no copy before, answers at once
 * without being read again. `doc` fetches and draws the copies.
 */
export function stillImageSource(src: string, doc: Document): string | Promise<string> {
  let still: Promise<string | null>;
  if (/^data:/i.test(src)) {
    const answer = recall(src);
    if (answer !== undefined) return answer ?? src;
    // A cached copy (of an animated bitmap, or an SVG that embeds one) spares decoding it again.
    const copy = stills.has(src) ? undefined : dataStill(src, doc);
    if (copy === null || typeof copy === "string") return remember(src, copy) ?? src;
    still = cached(src, () => copy ?? Promise.resolve(null));
  } else {
    const url = sameOriginFile(src, doc);
    if (!url || recall(url.href) === null) return src;
    const key = url.href;
    still = cached(key, () =>
      fetchStill(doc, url).then((copy) => {
        // A file that failed to load (not one read and found still) is tried again once evicted.
        if (copy === null) remember(key, null);
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

/** The still copies an SVG shown as an image embeds (see stillSvgMarkup), as image layers show them. */
function embedded(doc: Document): StillEmbed {
  return (src) => stillImageSource(src, doc);
}

/** Loads and decodes `src` in `doc`, so an image switched to it paints in the next frame. */
export function preload(src: string, doc: Document): Promise<void> {
  const img = doc.createElement("img");
  img.src = src;
  return img.decode().then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Points the SVG `<image>` and `<feImage>` elements under `root` (inline SVG of an HTML page) at
 * still copies of the animated images they show, through {@link stillImageSource}: they play them on
 * the browser's own clock, as an `<img>` does. Returns a promise that settles once every copy is in
 * place and decoded (it never rejects), or null when nothing is swapped.
 */
export function holdSvgImages(root: Document | Element, doc: Document): Promise<void> | null {
  const waits: Promise<void>[] = [];
  for (const attr of svgImageHrefs(root)) {
    const el = attr.ownerElement;
    const raw = attr.value.trim();
    // An `<feImage>` naming an element of the page.
    if (raw.startsWith("#")) continue;
    let src: string;
    try {
      src = new URL(raw, el?.baseURI).href;
    } catch {
      continue;
    }
    const swap = (copy: string): Promise<void> | undefined => {
      if (copy === src || !el) return;
      attr.value = copy;
      return preload(copy, el.ownerDocument);
    };
    const still = stillImageSource(src, doc);
    const swapped = typeof still === "string" ? swap(still) : still.then(swap);
    if (swapped) waits.push(swapped);
  }
  return waits.length > 0 ? Promise.all(waits).then(() => undefined) : null;
}
