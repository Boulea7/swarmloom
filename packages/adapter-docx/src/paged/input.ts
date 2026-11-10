import type { AdapterContext, SourceInput } from "@swarmloom/core";

export type InputErrorCode = "no-input" | "too-large" | "fetch-failed";

/** Problems reading the raw bytes of an input (before any format parsing). */
export class InputError extends Error {
  readonly code: InputErrorCode;

  constructor(code: InputErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InputError";
    this.code = code;
  }
}

function megabytes(n: number): string {
  return `${Math.round(n / (1024 * 1024))} MB`;
}

/**
 * Returns the bytes of a binary document input: `bytes` as given, or `url` fetched with the context's
 * abort signal. Text input is rejected because Word files are binary.
 *
 * @throws InputError when nothing usable is provided, the download fails or the size exceeds `maxBytes`.
 */
export async function readInputBytes(
  input: SourceInput,
  ctx: Pick<AdapterContext, "signal">,
  maxBytes: number,
): Promise<Uint8Array> {
  if (input.bytes) {
    if (input.bytes.length === 0) throw new InputError("no-input", "The file is empty.");
    if (input.bytes.length > maxBytes) {
      throw new InputError("too-large", `The file is larger than ${megabytes(maxBytes)}.`);
    }
    return input.bytes;
  }
  if (input.url) return fetchBytes(input.url, ctx.signal, maxBytes);
  if (input.text !== undefined) {
    throw new InputError("no-input", "Word documents are binary files; pass their bytes, not text.");
  }
  throw new InputError("no-input", "No document data was provided.");
}

async function fetchBytes(url: string, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: "omit" });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new InputError("fetch-failed", `Could not download ${url}. The server may not allow cross-origin access.`, {
      cause,
    });
  }
  if (!response.ok) throw new InputError("fetch-failed", `Downloading ${url} failed with HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw new InputError("too-large", `The file is larger than ${megabytes(maxBytes)}.`);
  const reader = response.body?.getReader();
  if (!reader) return checkSize(new Uint8Array(await response.arrayBuffer()), maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new InputError("too-large", `The file is larger than ${megabytes(maxBytes)}.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return checkSize(out, maxBytes);
}

function checkSize(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.length === 0) throw new InputError("no-input", "The downloaded file is empty.");
  if (bytes.length > maxBytes) throw new InputError("too-large", `The file is larger than ${megabytes(maxBytes)}.`);
  return bytes;
}
