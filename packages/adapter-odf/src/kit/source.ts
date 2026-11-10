import type { SourceInput } from "@swarmloom/core";
import { DocumentError } from "./errors";

/** Options of {@link readBytes}. */
export interface ReadOptions {
  /** Adapter id for messages. */
  format: string;
  /** Reject inputs larger than this. */
  maxBytes: number;
  signal?: AbortSignal;
}

/** Input bytes plus the name and URL they came with. */
export interface SourceBytes {
  bytes: Uint8Array;
  name?: string;
  url?: string;
}

function nameFromUrl(url: string | undefined): string | undefined {
  if (!url || /^(?:data|blob):/i.test(url)) return undefined;
  try {
    const last = new URL(url, "http://x.invalid/").pathname.split("/").pop();
    return last ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchBytes(url: string, opts: ReadOptions): Promise<Uint8Array> {
  if (!/^(?:https?|blob|data):/i.test(url)) throw new TypeError(`${opts.format}: unsupported URL scheme in "${url}"`);
  const res = await fetch(url, { signal: opts.signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new DocumentError(opts.format, "malformed", `fetching ${url} failed with HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > opts.maxBytes) throw tooLarge(opts, declared);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > opts.maxBytes) throw tooLarge(opts, bytes.length);
  return bytes;
}

function tooLarge(opts: ReadOptions, size: number): DocumentError {
  return new DocumentError(opts.format, "too-large", `the input has ${size} bytes; the limit is ${opts.maxBytes}`);
}

/**
 * Reads a {@link SourceInput} as bytes: `bytes` as given, `text` encoded as UTF-8, or `url`
 * fetched (http(s), blob or data; no credentials, no referrer).
 *
 * @throws TypeError for malformed inputs, DocumentError `empty` / `too-large` for content problems.
 */
export async function readBytes(input: SourceInput, opts: ReadOptions): Promise<SourceBytes> {
  if (!input || typeof input !== "object") throw new TypeError(`${opts.format}: load() needs a SourceInput object`);
  opts.signal?.throwIfAborted();
  let bytes: Uint8Array;
  if (input.bytes !== undefined) {
    if (!(input.bytes instanceof Uint8Array))
      throw new TypeError(`${opts.format}: SourceInput.bytes must be a Uint8Array`);
    bytes = input.bytes;
  } else if (input.text !== undefined) {
    if (typeof input.text !== "string") throw new TypeError(`${opts.format}: SourceInput.text must be a string`);
    bytes = new TextEncoder().encode(input.text);
  } else if (input.url) {
    bytes = await fetchBytes(input.url, opts);
  } else {
    throw new DocumentError(opts.format, "empty", "the input has no bytes, text or url");
  }
  if (bytes.length === 0) throw new DocumentError(opts.format, "empty", "the input is empty");
  if (bytes.length > opts.maxBytes) throw tooLarge(opts, bytes.length);
  const name = input.name ?? nameFromUrl(input.url);
  return { bytes, ...(name ? { name } : {}), ...(input.url ? { url: input.url } : {}) };
}
