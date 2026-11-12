/**
 * Still copies of animated bitmaps: GIF, APNG, animated WebP and AVIF image sequences. An `<img>`
 * plays them on the browser's own clock, which neither the world freeze nor an export's seek
 * reaches, so frames showing one would depend on wall time. They are shown as their first frame
 * instead (the default image, which canvas drawing and createImageBitmap use for animations too),
 * re-encoded as a PNG `data:` URL. A still bitmap is read only as far as its header says so, an
 * animated GIF, or an APNG whose first frame is its default image, only up to the end of that frame.
 */

/**
 * Most bytes read to find the first frame (a GIF or APNG one ends within them), and largest animated
 * file of other kinds (WebP, AVIF, an APNG that hides its default image) decoded whole; larger ones
 * keep their own clock.
 */
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

/** Where the blocks of a GIF start: after its header and global color table. */
function gifBlocks(b: Uint8Array): number {
  const packed = b[10] as number;
  return 13 + (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0);
}

/**
 * Where the GIF block at `at` (an image descriptor or an extension, `b[at]` 0x2c or 0x21) ends, after
 * its data sub-blocks; undefined when `b` ends first.
 */
function gifBlockEnd(b: Uint8Array, at: number): number | undefined {
  if (b[at] === 0x2c) {
    const local = b[at + 9];
    if (local === undefined) return undefined;
    // Descriptor, local color table and the LZW minimum code size, then the data sub-blocks.
    at += 11 + (local & 0x80 ? 3 << ((local & 7) + 1) : 0);
  } else {
    at += 2;
  }
  for (;;) {
    const size = b[at];
    if (size === undefined) return undefined;
    at += size + 1;
    if (size === 0) return at;
  }
}

/** A GIF animates when it has a second image descriptor. */
function gif(b: Uint8Array): Animation {
  let frames = 0;
  for (let at: number | undefined = gifBlocks(b); at !== undefined && at < b.length; at = gifBlockEnd(b, at)) {
    const block = b[at];
    if (block === 0x2c && ++frames > 1) return "image/gif";
    // The trailer, or bytes no decoder reads past.
    if (block !== 0x2c && block !== 0x21) return null;
  }
  return undefined;
}

/**
 * The first frame of an animated GIF as a GIF of its own: the bytes up to the end of the first
 * image's data, then the trailer. Undefined when `b` ends before that.
 */
function gifFirstFrame(b: Uint8Array): Uint8Array | undefined {
  for (let at: number | undefined = gifBlocks(b); at !== undefined && at < b.length; ) {
    const image = b[at] === 0x2c;
    if (!image && b[at] !== 0x21) return undefined;
    at = gifBlockEnd(b, at);
    if (image && at !== undefined) return concat([b.subarray(0, at), Uint8Array.of(0x3b)]);
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

const IEND = Uint8Array.of(0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82);

/**
 * The first frame of an APNG as a still PNG, when that frame is its default image (an fcTL chunk
 * comes before the image data): its chunks up to the first frame data chunk (fdAT) but the animation
 * control ones (acTL, fcTL), then IEND. Null when the default image is not part of the animation,
 * undefined when `b` ends before the cut.
 */
function apngFirstFrame(b: Uint8Array): Uint8Array | null | undefined {
  const kept: Uint8Array[] = [b.subarray(0, 8)];
  let framed = false;
  let image = false;
  for (let at = 8; at + 8 <= b.length; ) {
    const type = ascii(b, at + 4, 4);
    if (type === "fdAT" || type === "IEND") return image ? concat([...kept, IEND]) : null;
    const end = at + 12 + u32be(b, at);
    if (end > b.length) return undefined;
    if (type === "IDAT") {
      if (!framed) return null;
      image = true;
    }
    if (type === "fcTL") framed ||= !image;
    else if (type !== "acTL") kept.push(b.subarray(at, end));
    at = end;
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

/**
 * What the leading bytes `b` of an image file (all of it when `done`) give a still copy: the type and
 * the bytes its first frame decodes from (a GIF or APNG cut after that frame), null when there is none
 * (a still image or other file, or an animation too large to read), undefined when more bytes are
 * needed. `length` is the file's size when known, so one too large to read whole is let go at once.
 */
function firstFrame(b: Uint8Array, done: boolean, length = 0): { type: string; bytes: Uint8Array } | null | undefined {
  const type = animatedBitmapType(b);
  if (type === null) return null;
  if (type === undefined) return done || b.length > MAX_BITMAP_BYTES ? null : undefined;
  const cut = type === "image/gif" ? gifFirstFrame(b) : type === "image/png" ? apngFirstFrame(b) : null;
  if (cut) return { type, bytes: cut };
  if (b.length > MAX_BITMAP_BYTES || (cut === null && length > MAX_BITMAP_BYTES)) return null;
  return done ? { type, bytes: b } : undefined;
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

/**
 * Reader of a `data:` URL body from its head on: each call gives the bytes of its first `end`
 * characters (all of it once `end` reaches its length), or null when it does not decode (binary
 * percent-encoding too). A call decodes only the characters added since the last one, so reading a
 * body in growing prefixes costs one pass over it. A prefix leaves out a percent escape or base64
 * quantum it ends inside, until a later call completes it.
 */
function dataReader(body: string, base64: boolean): (end: number) => Uint8Array | null {
  let out = new Uint8Array(0);
  let size = 0;
  let read = 0;
  // A percent escape the last call ended inside, and base64 characters short of a whole quantum.
  let pending = "";
  let quantum = "";
  let failed = false;
  // Where the browser has it, several times faster on megabytes than atob and a loop copying its result.
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array }).fromBase64;
  const append = (chunk: Uint8Array | string): void => {
    if (size + chunk.length > out.length) {
      const grown = new Uint8Array(size + chunk.length);
      grown.set(out.subarray(0, size));
      out = grown;
    }
    if (typeof chunk !== "string") out.set(chunk, size);
    else for (let i = 0; i < chunk.length; i++) out[size + i] = chunk.charCodeAt(i) & 0xff;
    size += chunk.length;
  };
  return (end) => {
    if (failed) return null;
    const done = end >= body.length;
    let text = pending + body.slice(read, done ? body.length : end);
    read = done ? body.length : end;
    const partial = done ? 0 : text.endsWith("%") ? 1 : text.at(-2) === "%" ? 2 : 0;
    pending = text.slice(text.length - partial);
    text = text.slice(0, text.length - partial);
    if (text.includes("%")) {
      text = text.replace(/%([0-9a-f]{2})/gi, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    }
    if (!base64) {
      append(text);
      return out.subarray(0, size);
    }
    text = quantum + text.replace(/\s+/g, "");
    const whole = done ? text.length : text.length - (text.length % 4);
    quantum = text.slice(whole);
    try {
      append(fromBase64 ? fromBase64.call(Uint8Array, text.slice(0, whole)) : atob(text.slice(0, whole)));
    } catch {
      failed = true;
      return null;
    }
    return out.subarray(0, size);
  };
}

/**
 * An animated bitmap `data:` URL as its type and the bytes its first frame decodes from (see
 * {@link firstFrame}), or null for anything else. The body is read from its head, twice as far at
 * each step (decoding only what the step adds), until the header says the image is still or the
 * first frame has ended.
 */
export function animatedDataUrl(src: string): { type: string; bytes: Uint8Array } | null {
  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const base64 = /;base64$/i.test(src.slice(0, comma).trim());
  const hash = src.indexOf("#", comma);
  const body = src.slice(comma + 1, hash < 0 ? undefined : hash);
  const length = base64 ? (body.length * 3) / 4 : body.length / 3;
  const read = dataReader(body, base64);
  // Whole base64 quanta, so the head decodes on its own.
  for (let chars = base64 ? (HEAD_BYTES / 3) * 4 : HEAD_BYTES; ; chars *= 2) {
    const bytes = read(chars);
    const frame = bytes && firstFrame(bytes, chars >= body.length, length);
    if (frame !== undefined) return frame;
  }
}

function concat(chunks: Uint8Array[], size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)): Uint8Array {
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
 * only as far as its header, an animated GIF or APNG as far as its first frame (see
 * {@link firstFrame}; the response is cancelled there).
 */
export async function stillBitmapResponse(res: Response, doc: Document): Promise<string | null> {
  const length = Number(res.headers.get("content-length")) || 0;
  const reader = res.body?.getReader();
  if (!reader) return null;
  let chunks: Uint8Array[] = [];
  let size = 0;
  // Probed at the head, then each time the bytes read double, up to the most read.
  let probe = HEAD_BYTES;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        chunks.push(value);
        size += value.byteLength;
      }
      if (!done && size < probe) continue;
      const bytes = concat(chunks, size);
      chunks = [bytes];
      const frame = firstFrame(bytes, done, length);
      if (frame !== undefined) return frame && (await firstFrameUrl(frame.bytes, frame.type, doc));
      probe = Math.min(size * 2, MAX_BITMAP_BYTES + 1);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
