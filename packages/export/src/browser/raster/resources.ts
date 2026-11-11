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

/** What the export frame may load from the web: https images and fonts, or nothing. */
export type ResourcePolicy = "https" | "none";

/** Decides where a resource may be fetched from: its absolute URL, or null when it is refused. */
export type ResourceGate = (url: string) => string | null;

/**
 * The gate for a network policy, mirroring the CSP Studio gives its pages (decisions-v1 C03):
 * data: and blob: URLs and the page's own origin always, other https: URLs only under "https".
 * The rasterizer fetches from the exporting page, whose `connect-src` is wider than the frame's
 * `img-src`/`font-src`, so without this gate it would request what the frame was not allowed to
 * load. Relative URLs resolve against `base` (the frame document's base URL).
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
    if (target.protocol === "data:" || target.protocol === "blob:") return target.href;
    if (self !== null && self !== "null" && target.origin === self) return target.href;
    return policy === "https" && target.protocol === "https:" ? target.href : null;
  };
}

/**
 * Turns resource URLs into data URLs, once per URL: an SVG image (the frame snapshot) may only use
 * resources embedded in it. A URL the gate refuses is never requested; it is drawn from its loaded
 * element when there is one, else left blank. A resource that cannot be read (another site without
 * CORS) becomes {@link BLANK_IMAGE}. Either is reported once through `onWarning`.
 */
export class ResourceCache {
  readonly #done = new Map<string, string>();
  readonly #pending = new Map<string, Promise<string>>();
  readonly #fetch: typeof fetch;
  readonly #onWarning: (message: string) => void;
  readonly #gate: ResourceGate;

  constructor(fetcher: typeof fetch, onWarning: (message: string) => void, gate: ResourceGate) {
    this.#fetch = fetcher;
    this.#onWarning = onWarning;
    this.#gate = gate;
  }

  /** The data URL when already known (data URLs map to themselves), else undefined. */
  peek(url: string): string | undefined {
    if (url.startsWith("data:")) return url;
    return this.#done.get(url);
  }

  /**
   * Resolves `url` to a data URL. `fallback` is tried when the fetch fails (an image element can be
   * drawn into a canvas when the server allows it).
   */
  resolve(url: string, fallback?: () => string | null): Promise<string> {
    const known = this.peek(url);
    if (known !== undefined) return Promise.resolve(known);
    let pending = this.#pending.get(url);
    if (!pending) {
      pending = this.#load(url, fallback).then((data) => {
        this.#done.set(url, data);
        this.#pending.delete(url);
        return data;
      });
      this.#pending.set(url, pending);
    }
    return pending;
  }

  async #load(url: string, fallback?: () => string | null): Promise<string> {
    const target = this.#gate(url);
    if (target === null) {
      return drawn(fallback) ?? this.#blank(url, "the network setting does not allow it");
    }
    try {
      const response = await this.#fetch(target, { credentials: "omit" });
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
