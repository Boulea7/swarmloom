import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";
import { inspect } from "./detect";
import { describeInput, SourceError } from "./errors";
import { DEFAULT_MAX_BYTES, fetchSource, throwIfAborted, tooLarge } from "./fetch";
import { type FormatEntry, formats } from "./registry";

/** Options for {@link load}. */
export interface LoadOptions {
  /** Format list to resolve against. Default {@link formats}. */
  registry?: readonly FormatEntry[];
  /**
   * Skip detection and use this format: an adapter id ("markdown"), a file extension ("md") or a
   * MIME type ("text/markdown"). Encrypted containers are still rejected.
   */
  format?: string;
  /** Reject inputs larger than this many bytes. Default {@link DEFAULT_MAX_BYTES} (50 MB). */
  maxBytes?: number;
  /**
   * URL-only inputs are downloaded (with the size limit) before detection, keeping `url` so the
   * adapter can resolve relative resources. Set `false` to hand them to the adapter untouched.
   * Default true.
   */
  fetch?: boolean;
  /** Abort signal; defaults to `ctx.signal`. */
  signal?: AbortSignal;
}

function isRegistry(value: LoadOptions | readonly FormatEntry[] | undefined): value is readonly FormatEntry[] {
  return Array.isArray(value);
}

function defaultContext(signal: AbortSignal | undefined): AdapterContext {
  const doc = globalThis.document;
  if (!doc) throw new TypeError("load() needs ctx.document outside a browser");
  const dark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return { document: doc, width: doc.documentElement.clientWidth || 1280, theme: dark ? "dark" : "light", signal };
}

function supportedList(registry: readonly FormatEntry[]): string {
  return registry
    .filter((f) => f.id !== "dom")
    .map((f) => f.label)
    .join(", ");
}

/** Finds an entry by adapter id, extension or MIME type. */
function entryFor(hint: string, registry: readonly FormatEntry[]): FormatEntry | undefined {
  const key = hint.trim().toLowerCase().replace(/^\./, "");
  return (
    registry.find((f) => f.id === key) ??
    registry.find((f) => f.extensions.includes(key)) ??
    registry.find((f) => f.mime.includes(key.split(";")[0]?.trim() ?? key))
  );
}

function validate(input: SourceInput, max: number): void {
  if (typeof input !== "object" || input === null) throw new TypeError("load() needs a SourceInput object");
  if (input.element) return;
  const label = describeInput(input);
  if (input.bytes !== undefined) {
    if (!(input.bytes instanceof Uint8Array)) throw new TypeError("SourceInput.bytes must be a Uint8Array");
    if (input.bytes.length > max) throw tooLarge(label, input.bytes.length, max);
    if (input.bytes.length > 0) return;
  }
  if (input.text !== undefined) {
    if (typeof input.text !== "string") throw new TypeError("SourceInput.text must be a string");
    // Every UTF-16 code unit needs at least one UTF-8 byte, so this never under-counts.
    if (input.text.length > max) throw tooLarge(label, null, max);
    if (input.text.trim() !== "") return;
  }
  if (input.url && input.bytes === undefined && input.text === undefined) return;
  throw new SourceError("empty", `${label} is empty.`);
}

async function importAdapter(entry: FormatEntry): Promise<Adapter> {
  try {
    return await entry.loader();
  } catch (error) {
    throw new SourceError(
      "adapter-unavailable",
      `Could not load the ${entry.label} reader. Check the connection and try again.`,
      { cause: error, format: entry.id },
    );
  }
}

/** pdf.js and similar libraries signal passwords with a named exception. */
function isPasswordError(error: unknown): boolean {
  return error instanceof Error && /^Password(?:Exception|Error)$/.test(error.name);
}

/**
 * Detects the format of `input`, imports the matching adapter on demand and loads it.
 *
 * URL-only inputs are downloaded first (see {@link LoadOptions.fetch}). Inputs above the size limit,
 * empty inputs, unknown formats and password-protected documents are rejected with a
 * {@link SourceError} whose `code` says why and whose message says what to do. Errors thrown by
 * the adapter itself propagate unchanged (except password errors, which become `encrypted`).
 *
 * @param input File bytes, text, URL or live element.
 * @param ctx Layout context; defaults to the current document, its width and the preferred colour scheme.
 * @param options Load options, or (legacy form) the registry to resolve against.
 * @throws SourceError `unsupported` | `too-large` | `empty` | `encrypted` | `fetch-failed` | `adapter-unavailable`.
 */
export async function load(
  input: SourceInput,
  ctx?: AdapterContext,
  options?: LoadOptions | readonly FormatEntry[],
): Promise<LoadedSource> {
  const opts: LoadOptions = isRegistry(options) ? { registry: options } : (options ?? {});
  const registry = opts.registry ?? formats;
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const signal = opts.signal ?? ctx?.signal;
  validate(input, max);

  let source = input;
  if (
    opts.fetch !== false &&
    source.url &&
    source.bytes === undefined &&
    source.text === undefined &&
    !source.element
  ) {
    const fetched = await fetchSource(source.url, { maxBytes: max, signal });
    source = { ...fetched, name: input.name ?? fetched.name, type: input.type ?? fetched.type };
    validate(source, max);
  }

  const label = describeInput(source);
  const found = inspect(source, registry);
  const entry = opts.format ? entryFor(opts.format, registry) : registry.find((f) => f.id === found.id);
  if (found.encrypted) {
    throw new SourceError("encrypted", `${label} is password-protected. Remove the password and open it again.`, {
      format: entry?.id,
    });
  }
  if (!entry) {
    const what = opts.format ? `Unknown format "${opts.format}"` : `Unsupported file: ${label}`;
    throw new SourceError("unsupported", `${what}. Supported formats: ${supportedList(registry)}.`);
  }

  throwIfAborted(signal);
  const adapter = await importAdapter(entry);
  throwIfAborted(signal);
  let loaded: LoadedSource;
  try {
    loaded = await adapter.load(source, ctx ?? defaultContext(signal));
  } catch (error) {
    if (!isPasswordError(error)) throw error;
    throw new SourceError("encrypted", `${label} is password-protected. Remove the password and open it again.`, {
      cause: error,
      format: entry.id,
    });
  }
  if (signal?.aborted) {
    loaded.dispose?.();
    throwIfAborted(signal);
  }
  return loaded;
}
