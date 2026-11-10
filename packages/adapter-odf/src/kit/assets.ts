/** Raster and vector image types the adapters hand to `<img>`. */
export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp" | "image/svg+xml";

function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}

/**
 * Identifies an image by its magic bytes (never by a declared type, which documents get wrong).
 * SVG is recognised by an `<svg` tag in the first kilobyte. Returns null for anything else.
 */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  if (startsWith(bytes, [0x42, 0x4d]) && bytes.length > 26) return "image/bmp";
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  return /<svg[\s>]/i.test(head) ? "image/svg+xml" : null;
}

interface UrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

/**
 * Owns the `blob:` URLs of one loaded document. Images stay valid while the blueprint plays;
 * {@link AssetUrls.revokeAll} (called from `LoadedSource.dispose`) releases them.
 */
export class AssetUrls {
  private readonly urls: string[] = [];
  private readonly byKey = new Map<string, string>();

  constructor(
    private readonly api: UrlApi = URL,
    private readonly BlobCtor: typeof Blob = Blob,
  ) {}

  /** Number of URLs created so far. */
  get count(): number {
    return this.urls.length;
  }

  /**
   * Returns a blob URL for an image, or null when the bytes are not a known image type.
   * `key` (for example the archive path) deduplicates repeated references.
   */
  image(bytes: Uint8Array, key?: string): string | null {
    const cached = key === undefined ? undefined : this.byKey.get(key);
    if (cached) return cached;
    const mime = sniffImage(bytes);
    if (!mime) return null;
    const url = this.add(bytes, mime);
    if (key !== undefined) this.byKey.set(key, url);
    return url;
  }

  /** Wraps bytes of a known type in a blob URL. */
  add(bytes: Uint8Array, type: string): string {
    // A private copy: the source may be a view into a large archive buffer that should not stay alive.
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const url = this.api.createObjectURL(new this.BlobCtor([copy], { type }));
    this.urls.push(url);
    return url;
  }

  /** Releases every URL. Safe to call more than once. */
  revokeAll(): void {
    for (const url of this.urls.splice(0)) this.api.revokeObjectURL(url);
    this.byKey.clear();
  }
}

/** Decodes base64 (whitespace allowed), or returns null when it is not valid base64. */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  try {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Pixel size of a PNG, GIF or JPEG from its header, or undefined. */
export function imageSize(b: Uint8Array): { w: number; h: number } | undefined {
  const be16 = (p: number) => ((b[p] as number) << 8) | (b[p + 1] as number);
  const be32 = (p: number) => ((be16(p) << 16) | be16(p + 2)) >>> 0;
  const mime = sniffImage(b);
  if (mime === "image/png" && b.length >= 24) return { w: be32(16), h: be32(20) };
  if (mime === "image/gif" && b.length >= 10)
    return { w: (b[6] as number) | ((b[7] as number) << 8), h: (b[8] as number) | ((b[9] as number) << 8) };
  if (mime !== "image/jpeg") return undefined;
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) return undefined;
    const marker = b[p + 1] as number;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      p += 2;
      continue;
    }
    // Start-of-frame markers (baseline, progressive, ...) carry the size; DHT/JPG/DAC do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: be16(p + 7), h: be16(p + 5) };
    }
    p += 2 + be16(p + 2);
  }
  return undefined;
}
