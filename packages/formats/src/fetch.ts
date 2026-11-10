import type { SourceInput } from "@swarmloom/core";
import { formatBytes, SourceError } from "./errors";

/** Default upper bound on input size: 50 MB. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** Options for {@link fetchSource}. */
export interface FetchSourceOptions {
  /** Reject bodies larger than this many bytes. Default {@link DEFAULT_MAX_BYTES}. */
  maxBytes?: number;
  signal?: AbortSignal;
  /** Base for relative URLs. Default `document.baseURI` (browser) or `location.href`. */
  base?: string;
  /** Fetch implementation. Default `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** Throws the signal's reason (an AbortError by default) when it is aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/** Error for inputs over the byte limit, with a message that says what to do. */
export function tooLarge(label: string, size: number | null, max: number): SourceError {
  const actual = size === null ? `larger than ${formatBytes(max)}` : formatBytes(size);
  return new SourceError(
    "too-large",
    `${label} is ${actual}; the limit is ${formatBytes(max)}. Open a smaller file or raise maxBytes.`,
  );
}

function resolveUrl(url: string, base: string | undefined): URL {
  const fallback = base ?? globalThis.document?.baseURI ?? globalThis.location?.href;
  try {
    const resolved = new URL(url, fallback);
    if (!["http:", "https:", "data:", "blob:", "file:"].includes(resolved.protocol)) throw new TypeError("protocol");
    return resolved;
  } catch (error) {
    throw new SourceError("fetch-failed", `"${url}" is not a valid http(s), data: or blob: URL.`, { cause: error });
  }
}

function fileName(url: URL): string | undefined {
  if (url.protocol === "data:" || url.protocol === "blob:") return undefined;
  const last = url.pathname.split("/").pop();
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

async function readCapped(response: Response, max: number, label: string): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > max) throw tooLarge(label, bytes.length, max);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(label, null, max);
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Downloads a URL into a {@link SourceInput} (`name`, `url`, `type`, `bytes`) ready for `load()`.
 *
 * The size limit is enforced twice: against `Content-Length` before reading and while streaming,
 * so a lying or missing header cannot make it buffer more than `maxBytes`.
 *
 * @param url Absolute or relative (to `options.base`) http(s), data: or blob: URL.
 * @throws SourceError `fetch-failed` (invalid URL, network/CORS error, HTTP error status) or `too-large`.
 *   Rejects with the signal's reason when aborted.
 */
export async function fetchSource(url: string, options: FetchSourceOptions = {}): Promise<SourceInput> {
  const max = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const resolved = resolveUrl(url, options.base);
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") throw new SourceError("fetch-failed", "fetch() is not available here.");
  const href = resolved.href;
  const label = fileName(resolved) ?? (href.length > 80 ? `${href.slice(0, 77)}...` : href);
  let response: Response;
  try {
    response = await doFetch(href, { signal: options.signal, credentials: "same-origin" });
  } catch (error) {
    throwIfAborted(options.signal);
    throw new SourceError(
      "fetch-failed",
      `Could not download ${label}. Files on other sites need CORS headers; otherwise download the file and open it directly.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new SourceError("fetch-failed", `Could not download ${label}: HTTP ${response.status}.`);
  }
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (declared > max) throw tooLarge(label, declared, max);
  let bytes: Uint8Array;
  try {
    bytes = await readCapped(response, max, label);
  } catch (error) {
    throwIfAborted(options.signal);
    if (error instanceof SourceError) throw error;
    throw new SourceError("fetch-failed", `Download of ${label} was interrupted.`, { cause: error });
  }
  const type = response.headers.get("content-type")?.split(";")[0]?.trim() || undefined;
  const final = response.url ? new URL(response.url) : resolved;
  return { name: fileName(final) ?? fileName(resolved), url: final.href, type, bytes };
}
