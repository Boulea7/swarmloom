import type { AdapterContext, SourceInput } from "@swarmloom/core";

/**
 * Reads the text of a source input: `text`, UTF-8 `bytes` or a fetched `url`. Rejects inputs
 * larger than `maxBytes` before decoding them.
 *
 * @param what Format name used in error messages.
 */
export async function readText(
  input: SourceInput,
  maxBytes: number,
  what: string,
  signal?: AbortSignal,
): Promise<string> {
  const tooLarge = (n: number): Error => new RangeError(`${what} is too large (${n} bytes, limit ${maxBytes})`);
  if (typeof input.text === "string") {
    if (input.text.length > maxBytes) throw tooLarge(input.text.length);
    return input.text;
  }
  if (input.bytes instanceof Uint8Array) {
    if (input.bytes.byteLength > maxBytes) throw tooLarge(input.bytes.byteLength);
    return new TextDecoder("utf-8").decode(input.bytes);
  }
  if (typeof input.url === "string" && input.url) {
    const res = await fetch(input.url, { signal, credentials: "omit" });
    if (!res.ok) throw new Error(`Could not fetch the ${what} (${res.status} ${res.statusText})`.trim());
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw tooLarge(declared);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw tooLarge(bytes.byteLength);
    return new TextDecoder("utf-8").decode(bytes);
  }
  throw new TypeError(`The ${what} adapter needs text, bytes or a URL`);
}

/** Validates the adapter context the contract requires. */
export function checkContext(ctx: AdapterContext, what: string): void {
  if (!ctx || typeof ctx !== "object" || !ctx.document)
    throw new TypeError(`${what}: AdapterContext with a document is required`);
  if (!Number.isFinite(ctx.width) || ctx.width <= 0)
    throw new RangeError(`${what}: ctx.width must be positive, got ${ctx.width}`);
}

/** The file name without directories, from `input.name` or the URL path. */
export function baseName(input: SourceInput): string | undefined {
  let name = input.name;
  if (!name && input.url && !/^(?:data|blob):/i.test(input.url)) {
    try {
      name = decodeURIComponent(new URL(input.url, "http://x.invalid/").pathname);
    } catch {
      name = undefined;
    }
  }
  const base = name?.split(/[\\/]/).pop();
  return base || undefined;
}
