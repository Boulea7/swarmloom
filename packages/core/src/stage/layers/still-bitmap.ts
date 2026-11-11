/**
 * Still copies of animated bitmaps: GIF, APNG, animated WebP and AVIF image sequences. An `<img>`
 * plays them on the browser's own clock, which neither the world freeze nor an export's seek
 * reaches, so frames showing one would depend on wall time. They are shown as their first frame
 * instead (the default image, which canvas drawing and createImageBitmap use for animations too),
 * re-encoded as a PNG `data:` URL. A still bitmap is read only as far as its header says so.
 */

/** Largest animated file turned into a still copy (bytes); larger ones keep their own clock. */
const MAX_BITMAP_BYTES = 16 * 1024 * 1024;
/** Bytes read before the rest: enough for the header of every still format but GIF. */
const HEAD_BYTES = 48 * 1024;

/**
 * What the leading bytes of an image say: the MIME type of an animated bitmap, null for a still or
 * other file, undefined when they end before that is known.
 */
type Animation = string | null | undefined;

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = "";
  for (let i = at; i < at + len && i < b.length; i++) s += String.fromCharCode(b[i] as number);
  return s;
}

function u32be(b: Uint8Array, at: number): number {
  return (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
}

/** A GIF animates when it has a second image descriptor. */
function gif(b: Uint8Array): Animation {
  const packed = b[10] as number;
  let at = 13 + (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0);
  let frames = 0;
  while (at < b.length) {
    const block = b[at];
    if (block === 0x2c) {
      if (++frames > 1) return "image/gif";
      const local = b[at + 9];
      if (local === undefined) return undefined;
      // Descriptor, local color table and the LZW minimum code size, then the data sub-blocks.
      at += 11 + (local & 0x80 ? 3 << ((local & 7) + 1) : 0);
    } else if (block === 0x21) {
      at += 2;
    } else {
      // The trailer, or bytes no decoder reads past.
      return null;
    }
    for (;;) {
      const size = b[at];
      if (size === undefined) return undefined;
      at += size + 1;
      if (size === 0) break;
    }
  }
  return undefined;
}

/** A PNG animates (APNG) when an acTL chunk comes before its image data. */
function png(b: Uint8Array): Animation {
  let at = 8;
  while (at + 8 <= b.length) {
    const type = ascii(b, at + 4, 4);
    if (type === "acTL") return "image/png";
    if (type === "IDAT" || type === "IEND") return null;
    at += 12 + u32be(b, at);
  }
  return undefined;
}

/** A WebP animates when its VP8X header sets the animation flag. */
function webp(b: Uint8Array): Animation {
  if (b.length < 21) return undefined;
  return ascii(b, 12, 4) === "VP8X" && ((b[20] as number) & 0x02) !== 0 ? "image/webp" : null;
}

/** An AVIF file is an image sequence when its `ftyp` box lists the `avis` brand. */
function avif(b: Uint8Array): Animation {
  const end = u32be(b, 0);
  if (end > 4096) return null;
  if (b.length < end) return undefined;
  for (let at = 8; at + 4 <= end; at += 4) if (ascii(b, at, 4) === "avis") return "image/avif";
  return null;
}

/** Reads the leading bytes of an image file (see {@link Animation}). */
export function animatedBitmapType(b: Uint8Array): Animation {
  if (b.length < 12) return undefined;
  if (ascii(b, 0, 4) === "GIF8") return gif(b);
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return png(b);
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return webp(b);
  if (ascii(b, 4, 4) === "ftyp") return avif(b);
  return null;
}

/** PNG `data:` URL of the first frame of an animated bitmap; null when this browser cannot decode it. */
export async function firstFrameUrl(bytes: Uint8Array, type: string, doc: Document): Promise<string | null> {
  if (typeof createImageBitmap !== "function") return null;
  let frame: ImageBitmap | null = null;
  try {
    frame = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
    const canvas = doc.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(frame, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    // A file this browser cannot decode keeps its own clock, as an <img> would show it.
    return null;
  } finally {
    frame?.close();
  }
}

/** Bytes of a `data:` URL body, or null when it does not decode (binary percent-encoding too). */
function dataBytes(body: string, base64: boolean): Uint8Array | null {
  let text = body.replace(/%([0-9a-f]{2})/gi, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  if (base64) {
    try {
      text = atob(text.replace(/\s+/g, ""));
    } catch {
      return null;
    }
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/**
 * An animated bitmap `data:` URL as its type and bytes, or null for anything else. Only the head is
 * decoded until the header says the image may animate.
 */
export function animatedDataUrl(src: string): { type: string; bytes: Uint8Array } | null {
  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const base64 = /;base64$/i.test(src.slice(0, comma).trim());
  const hash = src.indexOf("#", comma);
  const body = src.slice(comma + 1, hash < 0 ? undefined : hash);
  if (body.length > MAX_BITMAP_BYTES * 3) return null;
  // Whole base64 quanta, so the head decodes on its own.
  const headChars = base64 ? (HEAD_BYTES / 3) * 4 : HEAD_BYTES;
  if (body.length > headChars) {
    const head = dataBytes(body.slice(0, headChars), base64);
    if (head && animatedBitmapType(head) === null) return null;
  }
  const bytes = dataBytes(body, base64);
  const type = bytes && bytes.length <= MAX_BITMAP_BYTES ? animatedBitmapType(bytes) : null;
  return bytes && type ? { type, bytes } : null;
}

function join(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * Still copy of a fetched image file when it is an animated bitmap, else null. A still file is read
 * only as far as its header (the response is cancelled there).
 */
export async function stillBitmapResponse(res: Response, doc: Document): Promise<string | null> {
  if (Number(res.headers.get("content-length")) > MAX_BITMAP_BYTES) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let probed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        chunks.push(value);
        size += value.byteLength;
      }
      if (size > MAX_BITMAP_BYTES) return null;
      if (!done) {
        if (!probed && size >= HEAD_BYTES) {
          probed = true;
          if (animatedBitmapType(join(chunks, size)) === null) return null;
        }
        continue;
      }
      const bytes = join(chunks, size);
      const type = animatedBitmapType(bytes);
      return type ? await firstFrameUrl(bytes, type, doc) : null;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
