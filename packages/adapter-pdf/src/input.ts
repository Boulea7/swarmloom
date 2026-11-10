/** Turns a SourceInput into validated PDF bytes. */

import type { SourceInput } from "@swarmloom/core";
import { abortError, PdfAdapterError } from "./errors";

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
/** The PDF header may follow up to 1 KiB of junk (readers, pdf.js included, accept it). */
const HEADER_WINDOW = 1024;

/** True when `%PDF-` occurs within the first KiB. */
export function hasPdfHeader(head: Uint8Array): boolean {
  const end = Math.min(head.length, HEADER_WINDOW) - MAGIC.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < MAGIC.length; j++) if (head[i + j] !== MAGIC[j]) continue outer;
    return true;
  }
  return false;
}

function tooLarge(size: number, max: number): PdfAdapterError {
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  return new PdfAdapterError("too-large", `This PDF is ${mb(size)}; the limit is ${mb(max)}`);
}

async function fetchBytes(url: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: "same-origin" });
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    throw new PdfAdapterError("input", `Could not download the PDF from ${url}`, { cause: error });
  }
  if (!response.ok) throw new PdfAdapterError("input", `Downloading the PDF failed with HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw tooLarge(declared, maxBytes);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge(size, maxBytes);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * Returns a private copy of the PDF bytes (pdf.js transfers its buffer to the worker,
 * so the caller's array must never be handed over).
 *
 * @throws PdfAdapterError "input" for missing or non-PDF data, "too-large" above `maxBytes`.
 */
export async function readPdfBytes(input: SourceInput, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (input.bytes) {
    if (input.bytes.byteLength > maxBytes) throw tooLarge(input.bytes.byteLength, maxBytes);
    bytes = input.bytes.slice();
  } else if (input.url) {
    bytes = await fetchBytes(input.url, maxBytes, signal);
  } else {
    throw new PdfAdapterError("input", "The PDF adapter needs file bytes or a URL");
  }
  if (!hasPdfHeader(bytes)) throw new PdfAdapterError("input", "This file is not a PDF (no %PDF- header)");
  return bytes;
}
