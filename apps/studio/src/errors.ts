import { formatById } from "./formats-meta";
import type { StudioI18n, StudioKey } from "./i18n";
import { formatSize } from "./ui/dom";

/** Reasons Studio reports itself; each maps to an `error.*` message. */
export type StudioErrorCode =
  | "unsupported"
  | "tooLarge"
  | "empty"
  | "encrypted"
  | "fetch"
  | "adapter"
  | "share"
  | "example"
  | "file"
  | "inbox"
  | "url"
  | "paste"
  | "handoff"
  | "player";

/** An expected, user-facing failure with the variables its message needs. */
export class StudioError extends Error {
  override readonly name = "StudioError";
  readonly code: StudioErrorCode;
  readonly vars: Record<string, string | number>;

  constructor(code: StudioErrorCode, vars: Record<string, string | number> = {}, options?: { cause?: unknown }) {
    super(`${code}${Object.keys(vars).length ? ` ${JSON.stringify(vars)}` : ""}`, options);
    this.code = code;
    this.vars = vars;
  }
}

/** Byte limit for opened files and downloads; matches the formats package default. */
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

/**
 * Rejects input over the lower limit some adapters apply (e.g. 2 MB for code) with a `tooLarge`
 * error that names the format, instead of letting the adapter throw an untranslated RangeError.
 *
 * @param size Byte length of binary input, or UTF-16 length of text (what the adapters measure).
 * @param format Adapter id, when known before detection.
 */
export function checkFormatLimit(size: number, format: string | undefined): void {
  if (!format) return;
  const limit = formatById(format)?.maxBytes;
  if (limit !== undefined && size > limit) throw new StudioError("tooLarge", { size, limit, format });
}

/** `@swarmloom/formats` SourceError codes mapped to Studio codes (duck-typed, no import needed). */
const SOURCE_CODES: Record<string, StudioErrorCode> = {
  unsupported: "unsupported",
  "too-large": "tooLarge",
  empty: "empty",
  encrypted: "encrypted",
  "fetch-failed": "fetch",
  "adapter-unavailable": "adapter",
};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** True for cancellations, which the UI ignores. */
export function isCancellation(error: unknown): boolean {
  return isAbort(error) || (error instanceof Error && error.name === "AbortError");
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

const KEYS: Record<StudioErrorCode, StudioKey> = {
  unsupported: "error.unsupported",
  tooLarge: "error.tooLarge",
  empty: "error.empty",
  encrypted: "error.encrypted",
  fetch: "error.fetch",
  adapter: "error.adapter",
  share: "error.share",
  example: "error.example",
  file: "error.file",
  inbox: "error.inbox",
  url: "error.url",
  paste: "error.paste",
  handoff: "error.handoff",
  player: "error.player",
};

export interface ErrorContext {
  /** Translated, comma-separated list of supported formats. */
  formats: string;
  /** Name or URL of the input being opened. */
  label?: string;
}

/** Human-readable, translated message for any error thrown while opening or playing a source. */
export function describeError(error: unknown, i18n: StudioI18n, ctx: ErrorContext): string {
  const limit = formatSize(MAX_INPUT_BYTES, i18n.locale);
  const base: Record<string, string | number> = {
    formats: ctx.formats,
    limit,
    url: ctx.label ?? "",
    name: ctx.label ?? "",
  };
  if (error instanceof StudioError) {
    const vars: Record<string, string | number> = { ...base, ...error.vars };
    if (typeof vars.size === "number") vars.size = formatSize(vars.size, i18n.locale);
    if (typeof vars.limit === "number") vars.limit = formatSize(vars.limit, i18n.locale);
    const format = typeof error.vars.format === "string" ? formatById(error.vars.format) : undefined;
    if (error.code === "tooLarge" && format) {
      vars.format = i18n.core(`format.${format.id}`, format.label);
      return i18n.t("error.tooLargeFormat", vars);
    }
    return i18n.t(KEYS[error.code], vars);
  }
  if (error instanceof Error && error.name === "SourceError") {
    const code = SOURCE_CODES[(error as Error & { code?: string }).code ?? ""];
    // The formats package does not expose the measured size, so its own message is the most precise.
    if (code === "tooLarge") return error.message;
    if (code) return i18n.t(KEYS[code], base);
  }
  // Adapters report their own size and complexity limits (bytes, elements, pixels) as RangeError.
  if (error instanceof Error && error.name === "RangeError") return i18n.t("error.tooComplex", base);
  return i18n.t("error.generic", { message: messageOf(error) });
}
