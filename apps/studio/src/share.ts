import { formatOfName } from "./formats-meta";
import { MAX_HASH_PAYLOAD } from "./route";
import { type StudioSettings, sanitizeSettings } from "./settings";

/**
 * Share links carry small text inputs inside the URL hash:
 * `#d=` + base64url(deflate-raw(UTF-8 JSON)). The hash never reaches a server.
 */
export interface SharePayload {
  /** File name with a textual extension, e.g. "notes.md"; decides the format. */
  name: string;
  text: string;
  /** Playback settings to reproduce the same performance (seed, speed, ...). */
  settings?: Partial<StudioSettings>;
}

/** Largest payload Studio creates; longer links get cut by chat apps and URL bars. */
export const MAX_SHARE_LENGTH = 16 * 1024;
/** Inflated size limit when decoding, which stops decompression bombs early. */
export const MAX_INFLATED_BYTES = 1024 * 1024;

const NAME_LIMIT = 120;

/**
 * The only settings a share link may carry: the ones that shape the performance. Remote assets,
 * sound, volume, theme, motion and locale always stay the recipient's own, whatever the link says.
 */
export const SHARE_SETTING_KEYS: readonly (keyof StudioSettings)[] = [
  "seed",
  "speed",
  "agents",
  "labels",
  "finale",
  "intro",
  "follow",
];

/** Validates untrusted settings and keeps only {@link SHARE_SETTING_KEYS}. */
function shareSettings(raw: unknown): Partial<StudioSettings> {
  const valid = sanitizeSettings(raw);
  const out: Record<string, unknown> = {};
  for (const key of SHARE_SETTING_KEYS) {
    if (valid[key] !== undefined) out[key] = valid[key];
  }
  return out as Partial<StudioSettings>;
}

/** Thrown for any link that cannot be decoded into a valid payload. */
export class ShareError extends Error {
  override readonly name = "ShareError";
}

/** Keeps a safe, short file name; null when the extension is not a shareable text format. */
export function sanitizeShareName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  // Strip directories and control characters; keep the visible name short.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we remove.
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (base === "" || base.length > NAME_LIMIT) return null;
  return formatOfName(base)?.textual ? base : null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new ShareError("not base64url");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One-chunk stream; typed with an ArrayBuffer backing so it pipes into (De)CompressionStream. */
function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Reads a stream into one buffer, failing as soon as it grows past `limit` bytes. */
async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ShareError("payload too large");
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function supported(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

/**
 * Encodes a payload for the `#d=` hash parameter.
 *
 * @throws ShareError when the name is not a text format or the browser lacks CompressionStream.
 */
export async function encodeShare(payload: SharePayload): Promise<string> {
  const name = sanitizeShareName(payload.name);
  if (!name) throw new ShareError("only text files can be shared as a link");
  if (!supported()) throw new ShareError("CompressionStream is not available");
  const settings = payload.settings ? shareSettings(payload.settings) : undefined;
  const json = JSON.stringify({ v: 1, n: name, x: payload.text, ...(settings ? { s: settings } : {}) });
  const raw = new TextEncoder().encode(json);
  const deflated = await collect(
    streamOf(raw).pipeThrough(new CompressionStream("deflate-raw")),
    Number.POSITIVE_INFINITY,
  );
  return toBase64Url(deflated);
}

/**
 * Decodes and validates a `#d=` payload from an untrusted link.
 *
 * @throws ShareError for malformed, oversized or invalid payloads.
 */
export async function decodeShare(encoded: string): Promise<SharePayload> {
  if (encoded === "" || encoded.length > MAX_HASH_PAYLOAD) throw new ShareError("empty or oversized payload");
  if (!supported()) throw new ShareError("DecompressionStream is not available");
  const deflated = fromBase64Url(encoded);
  let inflated: Uint8Array;
  try {
    inflated = await collect(
      streamOf(deflated).pipeThrough(new DecompressionStream("deflate-raw")),
      MAX_INFLATED_BYTES,
    );
  } catch (error) {
    if (error instanceof ShareError) throw error;
    throw new ShareError("payload is not valid deflate data");
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inflated));
  } catch {
    throw new ShareError("payload is not valid JSON");
  }
  if (typeof data !== "object" || data === null) throw new ShareError("payload is not an object");
  const record = data as Record<string, unknown>;
  if (record.v !== 1) throw new ShareError("unknown payload version");
  const name = sanitizeShareName(record.n);
  if (!name) throw new ShareError("payload has no valid file name");
  if (typeof record.x !== "string" || record.x.trim() === "") throw new ShareError("payload has no text");
  const settings = shareSettings(record.s);
  return Object.keys(settings).length > 0 ? { name, text: record.x, settings } : { name, text: record.x };
}
