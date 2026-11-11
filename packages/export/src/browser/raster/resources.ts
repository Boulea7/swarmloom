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

/** Base64 data URL of raw bytes. */
export function bytesToDataUrl(bytes: ArrayBuffer | ArrayBufferView, type: string): Promise<string> {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return blobToDataUrl(new Blob([view.slice()], { type }));
}

/**
 * Turns resource URLs into data URLs, once per URL: an SVG image (the frame snapshot) may only use
 * resources embedded in it. A resource that cannot be read (another site without CORS) becomes
 * {@link BLANK_IMAGE} and is reported once through `onWarning`.
 */
export class ResourceCache {
  readonly #done = new Map<string, string>();
  readonly #pending = new Map<string, Promise<string>>();
  readonly #fetch: typeof fetch;
  readonly #onWarning: (message: string) => void;

  constructor(fetcher: typeof fetch, onWarning: (message: string) => void) {
    this.#fetch = fetcher;
    this.#onWarning = onWarning;
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
    try {
      const response = await this.#fetch(url, { credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await blobToDataUrl(await response.blob());
    } catch (error) {
      try {
        const drawn = fallback?.();
        if (drawn) return drawn;
      } catch {
        // A canvas tainted by another site cannot be read either.
      }
      const reason = error instanceof Error ? error.message : String(error);
      this.#onWarning(`${shortUrl(url)} could not be embedded in the frame (${reason}); it is left blank`);
      return BLANK_IMAGE;
    }
  }
}

function shortUrl(url: string): string {
  return url.length > 80 ? `${url.slice(0, 77)}...` : url;
}
