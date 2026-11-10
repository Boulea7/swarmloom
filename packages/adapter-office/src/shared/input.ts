import type { SourceInput } from "@swarmloom/core";
import { OfficeFormatError, throwIfAborted } from "./errors";

/** Largest file either adapter accepts, bytes. */
export const MAX_INPUT_BYTES = 100 * 1024 * 1024;

/**
 * Returns the raw bytes of an input: `bytes` as given, `url` fetched (same rules as the page:
 * CORS applies, no credentials beyond the browser default), `text` encoded as UTF-8.
 *
 * @throws OfficeFormatError when there is nothing to read or the file is over {@link MAX_INPUT_BYTES}.
 */
export async function readBytes(input: SourceInput, signal?: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  let bytes: Uint8Array;
  if (input.bytes) {
    bytes = input.bytes;
  } else if (input.url) {
    const response = await fetch(input.url, { signal });
    if (!response.ok) throw new OfficeFormatError(`Could not fetch ${input.url} (HTTP ${response.status})`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_INPUT_BYTES) throw tooLarge(declared);
    bytes = new Uint8Array(await response.arrayBuffer());
  } else if (input.text !== undefined) {
    bytes = new TextEncoder().encode(input.text);
  } else {
    throw new OfficeFormatError("No file content was provided");
  }
  if (bytes.length > MAX_INPUT_BYTES) throw tooLarge(bytes.length);
  throwIfAborted(signal);
  return bytes;
}

function tooLarge(size: number): OfficeFormatError {
  const mb = (n: number) => Math.round(n / (1024 * 1024));
  return new OfficeFormatError(`The file is too large (${mb(size)} MB, limit ${mb(MAX_INPUT_BYTES)} MB)`);
}

/** File name without directories, from `name` or the URL path; `fallback` when neither is set. */
export function displayName(input: SourceInput, fallback: string): string {
  let name = input.name;
  if (!name && input.url) {
    try {
      name = decodeURIComponent(new URL(input.url, "http://x.invalid/").pathname);
    } catch {
      name = input.url;
    }
  }
  const base = name?.split(/[\\/]/).pop();
  return base || fallback;
}

/** Lower-case extension of the input name or URL, without the dot ("" when none). */
export function extensionOf(input: SourceInput): string {
  const base = displayName(input, "");
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** True for a Compound File Binary header (legacy .doc/.xls/.ppt). */
export function isCfb(bytes: Uint8Array): boolean {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return bytes.length >= 8 && sig.every((b, i) => bytes[i] === b);
}
