import type { SourceInput } from "@swarmloom/core";
import { LottieError, throwIfAborted } from "./errors";
import { formatBytes } from "./lottie/json";

/** What a source input holds: Lottie JSON text or a dotLottie archive. */
export type LottieSource = { kind: "json"; text: string } | { kind: "archive"; bytes: Uint8Array };

/** Size limits of {@link readLottieSource}, bytes. */
export interface SourceLimits {
  maxBytes: number;
  maxArchiveBytes: number;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function tooLarge(what: string, size: number, limit: number): LottieError {
  return new LottieError("too-large", `The ${what} is ${formatBytes(size)} (the limit is ${formatBytes(limit)}).`);
}

function fromBytes(bytes: Uint8Array, limits: SourceLimits): LottieSource {
  if (isZip(bytes)) {
    if (bytes.byteLength > limits.maxArchiveBytes)
      throw tooLarge(".lottie file", bytes.byteLength, limits.maxArchiveBytes);
    return { kind: "archive", bytes };
  }
  if (bytes.byteLength > limits.maxBytes) throw tooLarge("Lottie file", bytes.byteLength, limits.maxBytes);
  return { kind: "json", text: new TextDecoder("utf-8").decode(bytes) };
}

/**
 * Reads a source input: `text`, `bytes` (JSON or a ZIP archive) or a `url` fetched without
 * credentials or referrer. Sizes are checked before anything is decoded.
 *
 * @throws LottieError "too-large"; TypeError when the input holds nothing readable.
 */
export async function readLottieSource(
  input: SourceInput,
  limits: SourceLimits,
  signal?: AbortSignal,
): Promise<LottieSource> {
  if (typeof input.text === "string") {
    if (input.text.length > limits.maxBytes) throw tooLarge("Lottie file", input.text.length, limits.maxBytes);
    return { kind: "json", text: input.text };
  }
  if (input.bytes instanceof Uint8Array) return fromBytes(input.bytes, limits);
  if (typeof input.url === "string" && input.url) {
    const res = await fetch(input.url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new LottieError("invalid", `The Lottie file could not be downloaded (HTTP ${res.status}).`);
    const limit = Math.max(limits.maxBytes, limits.maxArchiveBytes);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > limit) throw tooLarge("download", declared, limit);
    const bytes = new Uint8Array(await res.arrayBuffer());
    throwIfAborted(signal);
    return fromBytes(bytes, limits);
  }
  throw new TypeError("The Lottie adapter needs text, bytes or a URL.");
}
