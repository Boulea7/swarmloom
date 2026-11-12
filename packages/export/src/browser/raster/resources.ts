/** A 1x1 transparent GIF: stands in for an image that cannot be embedded. */
export const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the resource"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Base64 data URL of raw bytes. The bytes may come from another realm (the export frame's font
 * faces), where `instanceof ArrayBuffer` is false, so the checks look at the brand instead.
 */
export function bytesToDataUrl(bytes: ArrayBuffer | ArrayBufferView, type: string): Promise<string> {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes as ArrayBuffer);
  return blobToDataUrl(new Blob([view.slice()], { type }));
}

/**
 * Pieces of the frame markup at least this long (data URLs of images and fonts) are kept from one
 * frame to the next as the same string, so their escaping and URI encoding are done once.
 */
export const LONG_PIECE = 16 * 1024;

/** Image types a smaller copy is made of (see {@link ResourceCache.fitted}): bitmaps, GIFs aside. */
const FITTED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

/** Data URLs shorter than this are embedded as they are: a smaller copy would save little. */
const MIN_FITTED_LENGTH = 64 * 1024;

/**
 * Images whose smaller copies are kept, the most recently used: a page that keeps making new images
 * (a script drawing into data URLs) would otherwise keep every one of them.
 */
const MAX_FITS = 64;

/** Quality of the smaller copy of a JPEG (the encoders' usual default). */
const JPEG_QUALITY = 0.92;

interface Size {
  width: number;
  height: number;
}

/** What is known of an image a smaller copy may be made of. */
interface Fit {
  /** Its size in px, null when it does not decode. */
  size: Promise<Size | null>;
  /** Its smaller copies, by the number of times it was halved. */
  copies: Map<number, Promise<string>>;
}

/** The type of a data URL that {@link ResourceCache.fitted} may make smaller, else null. */
function fittedType(data: string): string | null {
  if (data.length < MIN_FITTED_LENGTH) return null;
  const type = /^data:([^;,]*)/i.exec(data.slice(0, 64))?.[1]?.toLowerCase() ?? "";
  return FITTED_TYPES.has(type) ? type : null;
}

async function decodedImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function naturalSize(url: string): Promise<Size | null> {
  try {
    const img = await decodedImage(url);
    return img.naturalWidth > 0 && img.naturalHeight > 0
      ? { width: img.naturalWidth, height: img.naturalHeight }
      : null;
  } catch {
    return null;
  }
}

/**
 * How many times an image of `size` can be halved and still have as many pixels as a box of `width`
 * by `height` needs, however the image is fitted into it (stretched, contained or covering it); at
 * most down to 1 px. 0 when it is less than twice as large as that.
 */
function halvings(size: Size, width: number, height: number): number {
  const need = Math.max(width / size.width, height / size.height);
  if (!(need < 0.5)) return 0;
  const most = Math.floor(Math.log2(Math.min(size.width, size.height)));
  return Math.max(0, Math.min(most, need > 0 ? Math.floor(-Math.log2(need)) : most));
}

/**
 * The image `data` halved `times` times, each step averaging 2 x 2 pixels (one large step would
 * skip pixels where a browser filters with bilinear sampling only): a JPEG again for a JPEG, else a
 * PNG, which keeps transparency.
 */
async function halved(data: string, type: string, times: number): Promise<string> {
  const img = await decodedImage(data);
  let source: CanvasImageSource = img;
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  let canvas: OffscreenCanvas | null = null;
  for (let i = 0; i < times; i++) {
    width = Math.ceil(width / 2);
    height = Math.ceil(height / 2);
    canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return data;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    source = canvas;
  }
  if (!canvas) return data;
  const jpeg = type === "image/jpeg" || type === "image/jpg" || type === "image/pjpeg";
  const blob = await canvas.convertToBlob(jpeg ? { type: "image/jpeg", quality: JPEG_QUALITY } : { type: "image/png" });
  return blobToDataUrl(blob);
}

/** What the export frame may load from the web: https images and fonts, or nothing. */
export type ResourcePolicy = "https" | "none";

/** A URL the gate lets through: absolute, and `remote` when another site serves it. */
export interface GatedUrl {
  href: string;
  remote: boolean;
}

/** Decides where a resource may come from, or returns null when it is refused. */
export type ResourceGate = (url: string) => GatedUrl | null;

/**
 * The gate for a network policy, mirroring the CSP Studio gives its pages (decisions-v1 C03):
 * data: and blob: URLs and the page's own origin always, other https: URLs (remote) only under
 * "https". The rasterizer fetches from the exporting page, whose `connect-src` is wider than the
 * frame's `img-src`/`font-src`, so without this gate it would request what the frame was not
 * allowed to load. Relative URLs resolve against `base` (the frame document's base URL).
 */
export function networkGate(policy: ResourcePolicy, base: string): ResourceGate {
  let self: string | null = null;
  try {
    self = new URL(base).origin;
  } catch {
    // No usable base: nothing counts as the page's own origin.
  }
  return (url) => {
    let target: URL;
    try {
      target = new URL(url, base);
    } catch {
      return null;
    }
    if (target.protocol === "data:" || target.protocol === "blob:") return { href: target.href, remote: false };
    if (self !== null && self !== "null" && target.origin === self) return { href: target.href, remote: false };
    return policy === "https" && target.protocol === "https:" ? { href: target.href, remote: true } : null;
  };
}

/** What a resource is used as: the frame loads images without CORS and fonts with it. */
type ResourceKind = "image" | "font";

/**
 * Turns resource URLs into data URLs, once per URL: an SVG image (the frame snapshot) may only use
 * resources embedded in it. A URL the gate refuses is never requested, and neither is another
 * site's image: the frame loads that without CORS, so sends no `Origin`, while a fetch from the
 * exporting page is a CORS request that would send the page's origin to the site. Such a URL is
 * drawn from its loaded element when that can be read, else left blank. Another site's font is
 * fetched: the frame's own load of a font is a CORS request too. A resource that cannot be read
 * (another site without CORS) becomes {@link BLANK_IMAGE}. Either is reported once through
 * `onWarning`. Pictures drawn from elements are kept too, while the element stays in the same
 * state ({@link picture}), and so are the smaller copies of large images ({@link fitted}) and the
 * markup written for long data URLs ({@link markup}).
 */
export class ResourceCache {
  /** Keyed by kind and URL: another site's URL may be fetched as a font but not as an image. */
  readonly #done = new Map<string, string>();
  readonly #pending = new Map<string, Promise<string>>();
  readonly #pictures = new WeakMap<object, { key: string; url: string }>();
  readonly #fits = new Map<string, Fit>();
  /** Markup of long data URLs by writer and data URL, made or used for this frame and the last. */
  #markup = new Map<(data: string) => string, Map<string, string>>();
  #lastMarkup = new Map<(data: string) => string, Map<string, string>>();
  readonly #fetch: typeof fetch;
  readonly #onWarning: (message: string) => void;
  readonly #gate: ResourceGate;
  readonly #reported = new Set<string>();

  constructor(fetcher: typeof fetch, onWarning: (message: string) => void, gate: ResourceGate) {
    this.#fetch = fetcher;
    this.#onWarning = onWarning;
    this.#gate = gate;
  }

  /** Reports `message` through `onWarning`, once however many frames meet the same problem. */
  report(message: string): void {
    if (this.#reported.has(message)) return;
    this.#reported.add(message);
    this.#onWarning(message);
  }

  /**
   * The data URL of what `element` shows in the state `key` names: drawn by `draw` only when the
   * element was last drawn in another state. Encoding a paused video's frame again every frame
   * would block the main thread for tens of milliseconds to make the same PNG.
   */
  picture(element: object, key: string, draw: () => string): string {
    const known = this.#pictures.get(element);
    if (known?.key === key) return known.url;
    const url = draw();
    this.#pictures.set(element, { key, url });
    return url;
  }

  /**
   * The image data URL `data`, or a smaller copy of it when it is a large bitmap (a photo) with at
   * least twice the pixels a box of `width` by `height` device px needs: the copy is the image
   * halved as often as that allows, made once for each number of halvings. An SVG image decodes
   * every image it embeds again whenever its markup changes, in one main-thread task: eight 1600 x
   * 1200 photos shown as thumbnails held the page for about 300 ms a frame.
   */
  fitted(data: string, width: number, height: number): Promise<string> {
    const type = fittedType(data);
    if (type === null) return Promise.resolve(data);
    const fit = this.#fits.get(data) ?? { size: naturalSize(data), copies: new Map() };
    // Kept in the order of use: the image used longest ago goes first.
    this.#fits.delete(data);
    this.#fits.set(data, fit);
    if (this.#fits.size > MAX_FITS) this.#fits.delete(this.#fits.keys().next().value as string);
    const { size, copies } = fit;
    return size.then((known) => {
      const times = known ? halvings(known, width, height) : 0;
      if (times === 0) return data;
      let copy = copies.get(times);
      if (!copy) {
        // A copy that cannot be made (a tainted or unsupported canvas) leaves the image as it is.
        copy = halved(data, type, times).catch(() => data);
        copies.set(times, copy);
      }
      return copy;
    });
  }

  /**
   * What `write` makes of the data URL `data` (escaped for an attribute, quoted for CSS): for one
   * of at least {@link LONG_PIECE} characters, the same string as on the frame before, so it is
   * escaped once and its URI encoding can be reused rather than redone for megabytes every frame.
   */
  markup(data: string, write: (data: string) => string): string {
    if (data.length < LONG_PIECE) return write(data);
    let made = this.#markup.get(write);
    if (!made) {
      made = new Map();
      this.#markup.set(write, made);
    }
    let text = made.get(data);
    if (text === undefined) {
      text = this.#lastMarkup.get(write)?.get(data) ?? write(data);
      made.set(data, text);
    }
    return text;
  }

  /** Starts the markup of a frame: what the frame before it did not use is let go. */
  nextFrame(): void {
    this.#lastMarkup = this.#markup;
    this.#markup = new Map();
  }

  /** The data URL of an image when already known (data URLs map to themselves), else undefined. */
  peek(url: string): string | undefined {
    if (url.startsWith("data:")) return url;
    return this.#done.get(`image ${url}`);
  }

  /**
   * Resolves an image `url` to a data URL. `fallback` draws the loaded element instead (into a
   * canvas, readable when the frame loaded it from its own origin or with CORS): it is tried when
   * the URL is another site's or the fetch fails.
   */
  resolve(url: string, fallback?: () => string | null): Promise<string> {
    return this.#get("image", url, fallback);
  }

  /** Resolves a font `url` to a data URL. */
  font(url: string): Promise<string> {
    return this.#get("font", url);
  }

  #get(kind: ResourceKind, url: string, fallback?: () => string | null): Promise<string> {
    if (url.startsWith("data:")) return Promise.resolve(url);
    const key = `${kind} ${url}`;
    const known = this.#done.get(key);
    if (known !== undefined) return Promise.resolve(known);
    let pending = this.#pending.get(key);
    if (!pending) {
      pending = this.#load(kind, url, fallback).then((data) => {
        this.#done.set(key, data);
        this.#pending.delete(key);
        return data;
      });
      this.#pending.set(key, pending);
    }
    return pending;
  }

  async #load(kind: ResourceKind, url: string, fallback?: () => string | null): Promise<string> {
    const target = this.#gate(url);
    if (target === null) {
      return drawn(fallback) ?? this.#blank(url, "the network setting does not allow it");
    }
    if (target.remote && kind === "image") {
      return drawn(fallback) ?? this.#blank(url, "images from other sites are not requested again for export");
    }
    try {
      // The adapters load remote images and fonts without a referrer (docs/en/privacy.md); the
      // exporting page may have the default policy, so the fetch says so itself.
      const response = await this.#fetch(target.href, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await blobToDataUrl(await response.blob());
    } catch (error) {
      return drawn(fallback) ?? this.#blank(url, error instanceof Error ? error.message : String(error));
    }
  }

  #blank(url: string, reason: string): string {
    this.#onWarning(`${shortUrl(url)} could not be embedded in the frame (${reason}); it is left blank`);
    return BLANK_IMAGE;
  }
}

/** The fallback's data URL, or null when there is none or it cannot be read. */
function drawn(fallback?: () => string | null): string | null {
  try {
    return fallback?.() || null;
  } catch {
    // A canvas tainted by another site cannot be read either.
    return null;
  }
}

function shortUrl(url: string): string {
  return url.length > 80 ? `${url.slice(0, 77)}...` : url;
}
