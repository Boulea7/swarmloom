import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/** Text read from a {@link SourceInput}, plus where it came from. */
export interface SourceText {
  text: string;
  /** File name: SourceInput.name, else the last URL path segment. */
  name?: string;
  /** Absolute URL when the input had one (used as the base for relative links). */
  url?: string;
  /** MIME type reported by the input or the server, without parameters. */
  mime?: string;
}

export interface ReadSourceOptions {
  /** Adapter id used in error messages. */
  adapter: string;
  /** Reject inputs larger than this many bytes (UTF-16 code units for text). */
  maxBytes: number;
  /** Abort a URL fetch after this many ms. Default 15 000. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Base for relative URLs. Default: the global document's base URI when there is one. */
  baseUrl?: string;
  /**
   * Custom byte decoder (the HTML adapter also honours `<meta charset>`). `charset` is the label
   * from the MIME type or the HTTP header when there is one. Default {@link decodeText}.
   */
  decode?: (bytes: Uint8Array, charset?: string) => string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Formats a byte count for error messages ("2.4 MB"). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Decodes bytes as text: UTF-8/UTF-16 by BOM, else strict UTF-8, else windows-1252 (the WHATWG
 * fallback for legacy Western text). Never throws.
 */
export function decodeText(bytes: Uint8Array, label?: string): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (label) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unknown label: fall through to detection.
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** File name from a URL path ("https://x.dev/a/b.ts?raw=1" -> "b.ts"). */
export function nameFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url, "http://local.invalid/").pathname;
    const last = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
    return last || undefined;
  } catch {
    return undefined;
  }
}

/** The charset parameter of a MIME type ("text/html; charset=gbk" -> "gbk"). */
export function charsetOf(mime: string | null | undefined): string | undefined {
  return mime ? /;\s*charset="?([\w.:-]+)/i.exec(mime)?.[1] : undefined;
}

function defaultBase(): string | undefined {
  const doc = (globalThis as { document?: Document }).document;
  const base = doc?.baseURI;
  return base && /^(?:https?|file):/i.test(base) ? base : undefined;
}

/** Combines an optional caller signal with a timeout. `done()` clears the timer. */
function timeoutSignal(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), ms);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

async function readLimited(response: Response, maxBytes: number, what: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RangeError(`${what} is ${formatBytes(declared)}, over the ${formatBytes(maxBytes)} limit`);
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RangeError(`${what} is over the ${formatBytes(maxBytes)} limit`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * Reads the text of a source: `text`, else `bytes`, else fetches `url`. Enforces a size limit and
 * a timeout, and turns network and CORS failures into an actionable message (the extension and
 * the CLI can read pages a web page cannot).
 */
export async function readSource(input: SourceInput, opts: ReadSourceOptions): Promise<SourceText> {
  const { adapter, maxBytes } = opts;
  const decode = opts.decode ?? decodeText;
  const mime = input.type?.split(";", 1)[0]?.trim().toLowerCase() || undefined;
  const name = input.name ?? (input.url ? nameFromUrl(input.url) : undefined);

  if (typeof input.text === "string") {
    if (input.text.length > maxBytes) {
      throw new RangeError(
        `${adapter}: input is ${formatBytes(input.text.length)}, over the ${formatBytes(maxBytes)} limit`,
      );
    }
    return { text: input.text, name, url: input.url, mime };
  }
  if (input.bytes) {
    if (!(input.bytes instanceof Uint8Array)) throw new TypeError(`${adapter}: SourceInput.bytes must be a Uint8Array`);
    if (input.bytes.byteLength > maxBytes) {
      throw new RangeError(
        `${adapter}: file is ${formatBytes(input.bytes.byteLength)}, over the ${formatBytes(maxBytes)} limit`,
      );
    }
    return { text: decode(input.bytes, charsetOf(input.type)), name, url: input.url, mime };
  }
  if (!input.url) throw new TypeError(`${adapter}: input needs text, bytes or url`);

  let url: URL;
  try {
    url = new URL(input.url, opts.baseUrl ?? defaultBase());
  } catch {
    throw new TypeError(`${adapter}: invalid URL ${JSON.stringify(input.url)}`);
  }
  if (!/^(?:https?|blob|data|file):$/.test(url.protocol)) {
    throw new TypeError(`${adapter}: unsupported URL scheme ${url.protocol}`);
  }

  const timed = timeoutSignal(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url.href, { signal: timed.signal, credentials: "same-origin", redirect: "follow" });
    } catch (error) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? error;
      if (isAbort(error)) throw new Error(`${adapter}: fetching ${url.href} timed out`);
      throw new Error(
        `${adapter}: could not fetch ${url.href}. The site may not allow other pages to read it (CORS), ` +
          "or the network is unreachable. Open the page with the SwarmLoom browser extension, " +
          `or render it with the CLI: npx swarmloom render ${url.href}`,
      );
    }
    if (!response.ok) throw new Error(`${adapter}: fetching ${url.href} failed with HTTP ${response.status}`);
    const served = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || undefined;
    const bytes = await readLimited(response, maxBytes, `${adapter}: ${url.href}`).catch((error: unknown) => {
      if (isAbort(error)) throw new Error(`${adapter}: fetching ${url.href} timed out`);
      throw error;
    });
    const text = decode(bytes, charsetOf(response.headers.get("content-type")) ?? charsetOf(input.type));
    return {
      text,
      name: name ?? nameFromUrl(response.url || url.href),
      url: response.url || url.href,
      mime: mime ?? served,
    };
  } finally {
    timed.done();
  }
}

/**
 * What the text adapters return: the contract's LoadedSource plus plain-English notes about
 * content that was removed or approximated (unsafe URLs, formulas that failed, fonts that did not
 * load). Hosts show them next to the player; nothing is dropped silently.
 */
export interface LoadedText extends LoadedSource {
  warnings: string[];
}

/** An {@link Adapter} whose `load` resolves to {@link LoadedText} (or a richer result). Still a plain Adapter for registries. */
export interface TextAdapter<R extends LoadedText = LoadedText> extends Adapter {
  load(input: SourceInput, ctx: AdapterContext): Promise<R>;
}
