/** Options of {@link createPdfAdapter}, their defaults and validation. */

/** Configuration of the PDF adapter. Every member is optional. */
export interface PdfAdapterOptions {
  /** Pages loaded from the start of the document; later pages are dropped and reported in `Blueprint.truncated`. Default 30. */
  maxPages?: number;
  /** Width of the widest page in CSS px; narrower contexts shrink pages to fit. Default 920. */
  maxPageWidth?: number;
  /** Device pixels per CSS px of the page bitmaps. Default `min(devicePixelRatio, 2)`. */
  pixelRatio?: number;
  /** Upper bound on the pixels of one page bitmap; larger pages render at a lower ratio. Default 5,000,000. */
  maxPagePixels?: number;
  /** Largest accepted file in bytes. Default 64 MiB. */
  maxBytes?: number;
  /** A page that takes longer to render ends the load at the previous page. Default 20000 ms. */
  renderTimeoutMs?: number;
  /**
   * How page bitmaps are referenced: `"blob"` object URLs (default, cheapest; revoked by `dispose()`)
   * or `"data"` URLs (survive serialization, e.g. a blueprint saved to JSON or played in another document).
   */
  urlType?: "blob" | "data";
  /**
   * pdf.js build: `"auto"` (default) uses the legacy build when the browser lacks built-ins the modern one needs.
   * Where `Promise.withResolvers` is missing (Chrome/Edge 116-118, Safari before 17.4) the adapter installs it
   * and parses on the main thread, because the default worker would lack it.
   */
  build?: "auto" | "modern" | "legacy";
  /**
   * URL of `pdf.worker.min.mjs` from the same pdfjs-dist version and build. By default the adapter asks the
   * bundler for it (`new URL("pdfjs-dist/...", import.meta.url)`), which Vite, webpack 5 and Parcel resolve.
   * A custom worker must provide `Promise.withResolvers` itself in browsers that lack it.
   */
  workerSrc?: string | URL;
  /** A caller-owned pdf.js worker (e.g. created from an extension URL). Never terminated by the adapter. */
  workerPort?: Worker;
  /** Parse on the main thread instead of a worker (slower; for environments that forbid workers). */
  disableWorker?: boolean;
  /** Base URL (with trailing slash) of the pdfjs-dist `cmaps/` folder, for CJK PDFs with non-embedded fonts. */
  cMapUrl?: string;
  /** Base URL (with trailing slash) of the pdfjs-dist `standard_fonts/` folder. */
  standardFontDataUrl?: string;
  /** Base URL (with trailing slash) of the pdfjs-dist `wasm/` folder (JPEG 2000 and JBIG2 decoders). */
  wasmUrl?: string;
  /** Password for encrypted PDFs. */
  password?: string;
}

export interface ResolvedOptions {
  maxPages: number;
  maxPageWidth: number;
  pixelRatio: number | undefined;
  maxPagePixels: number;
  maxBytes: number;
  renderTimeoutMs: number;
  urlType: "blob" | "data";
  build: "auto" | "modern" | "legacy";
  workerSrc: string | undefined;
  workerPort: Worker | undefined;
  disableWorker: boolean;
  cMapUrl: string | undefined;
  standardFontDataUrl: string | undefined;
  wasmUrl: string | undefined;
  password: string | undefined;
}

export const DEFAULTS = {
  maxPages: 30,
  maxPageWidth: 920,
  maxPixelRatio: 2,
  maxPagePixels: 5_000_000,
  maxBytes: 64 * 1024 * 1024,
  renderTimeoutMs: 20_000,
} as const;

function positive(name: string, value: number | undefined, fallback: number, integer = false): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new RangeError(
      `PDF adapter option ${name} must be a positive ${integer ? "integer" : "number"}, got ${value}`,
    );
  }
  return value;
}

function oneOf<T extends string>(name: string, value: T | undefined, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw new RangeError(`PDF adapter option ${name} must be one of ${allowed.join(", ")}`);
  return value;
}

/**
 * Applies defaults and rejects nonsensical values early (at adapter creation, not mid-load).
 *
 * @throws RangeError for non-positive or non-finite numbers and unknown enum values.
 */
export function resolveOptions(o: PdfAdapterOptions = {}): ResolvedOptions {
  return {
    maxPages: positive("maxPages", o.maxPages, DEFAULTS.maxPages, true),
    maxPageWidth: positive("maxPageWidth", o.maxPageWidth, DEFAULTS.maxPageWidth),
    pixelRatio: o.pixelRatio === undefined ? undefined : positive("pixelRatio", o.pixelRatio, 1),
    maxPagePixels: positive("maxPagePixels", o.maxPagePixels, DEFAULTS.maxPagePixels, true),
    maxBytes: positive("maxBytes", o.maxBytes, DEFAULTS.maxBytes, true),
    renderTimeoutMs: positive("renderTimeoutMs", o.renderTimeoutMs, DEFAULTS.renderTimeoutMs),
    urlType: oneOf("urlType", o.urlType, ["blob", "data"], "blob"),
    build: oneOf("build", o.build, ["auto", "modern", "legacy"], "auto"),
    workerSrc: o.workerSrc === undefined ? undefined : String(o.workerSrc),
    workerPort: o.workerPort,
    disableWorker: o.disableWorker === true,
    cMapUrl: o.cMapUrl,
    standardFontDataUrl: o.standardFontDataUrl,
    wasmUrl: o.wasmUrl,
    password: o.password,
  };
}
