/**
 * Shared constants and message shapes of the SwarmLoom bookmarklet.
 *
 * Three parties use this module:
 *  - the loader (the `javascript:` URL) injects the hosted bundle and, when the page blocks it,
 *    hands a serialized copy of the page to the Studio;
 *  - the hosted bundle (`swarm.js`) reads its options and registers its toggle handle;
 *  - the Studio receives the page copy (see PROTOCOL.md; it may import this module as
 *    `@swarmloom/bookmarklet/protocol`).
 *
 * The constants are inlined into the size-limited loader; {@link parsePagePayload} is not.
 */

/** Version of the Studio handoff payload. Receivers reject other versions. */
export const PROTOCOL_VERSION = 1;

/**
 * Page handoff message name. Studio -> opener: this bare string requests the page.
 * Opener -> Studio: the `type` of the answer, a {@link PagePayload}.
 */
export const MSG_PAGE = "swarmloom:page";

/**
 * `id` of the injected module script (and of the loader's "Open in Studio" button), and also the
 * `dataset` key of the option string on that script, i.e. its `data-swarmloom-bm` attribute.
 * Deliberately unlikely as a page's own id: the loader removes the element with this id.
 */
export const SCRIPT_ID = "swarmloomBm";

/**
 * Window property holding the hosted bundle's {@link BookmarkletHandle}. Must differ from
 * {@link SCRIPT_ID} (an element id is also a named property of `window`) and from the export
 * render page's `window.__swarmloom`.
 */
export const GLOBAL_KEY = "__swarmloomBm";

/** Upper bound receivers accept for {@link PagePayload.html}, in UTF-16 code units (32 Mi). */
export const MAX_PAGE_HTML_LENGTH = 32 * 1024 * 1024;

/**
 * State of the hosted bundle: "starting" while it snapshots the page, "running" while a player
 * exists (building, finished or live), "failed" after an in-page failure (the notice offers the
 * Studio), "idle" otherwise.
 */
export type BookmarkletState = "idle" | "starting" | "running" | "failed";

/** Handle the hosted bundle stores at `window[GLOBAL_KEY]`; the loader calls it on later clicks. */
export interface BookmarkletHandle {
  /**
   * Starts a rebuild with the given option string (see options.ts), or stops the one in progress.
   * A finished or live rebuild is replaced by a new one.
   */
  toggle(options?: string | null): void;
  /** Current state, for diagnostics and tests. */
  readonly state: BookmarkletState;
}

/**
 * Why the page was handed to the Studio:
 *  - "blocked": a Content Security Policy or Trusted Types rejected the bundle;
 *  - "error": the bundle failed to load (CSP in some browsers, or the network);
 *  - "timeout": the bundle did not load in time;
 *  - "manual": the bundle loaded but could not rebuild in place, and the user chose the Studio.
 */
export type HandoffReason = "blocked" | "error" | "timeout" | "manual";

/** Opener -> Studio: a serialized copy of the page the bookmarklet ran on. */
export interface PagePayload {
  type: typeof MSG_PAGE;
  v: typeof PROTOCOL_VERSION;
  reason: HandoffReason;
  /** `document.URL` of the page. Informational: trust `MessageEvent.origin`, not this. */
  url: string;
  /**
   * `<!DOCTYPE html>` (when the page has one), then `<base href="{document.baseURI}">`, then the
   * `documentElement.outerHTML` of a copy with password `value` attributes emptied and
   * CSSOM-inserted rules written into their `<style>` elements. The HTML parser moves the `<base>`
   * to the start of `<head>`, so rendered as a document every relative URL resolves to the original
   * absolute URL. Untrusted markup that still contains scripts: see PROTOCOL.md.
   */
  html: string;
  /**
   * Visible area at capture time in document CSS px: `x`/`y` are the window scroll offsets,
   * `w`/`h` the layout viewport size (`innerWidth`/`innerHeight`), `dpr` the devicePixelRatio.
   */
  viewport: { x: number; y: number; w: number; h: number; dpr: number };
}

/** Result of {@link parsePagePayload}. */
export type ParseResult = { ok: true; payload: PagePayload } | { ok: false; error: string };

const REASONS: readonly unknown[] = ["blocked", "error", "timeout", "manual"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAbsoluteUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= 8192 && URL.canParse(value);
}

/**
 * Validates an untrusted `MessageEvent.data` as a {@link PagePayload}.
 * Never throws; returns the first problem found. Receivers must still check the event's
 * `source` and `origin` (see PROTOCOL.md) and treat `html` as untrusted markup.
 */
export function parsePagePayload(data: unknown): ParseResult {
  if (!isRecord(data) || data.type !== MSG_PAGE) return { ok: false, error: "not a page message" };
  if (data.v !== PROTOCOL_VERSION) return { ok: false, error: `unsupported version ${String(data.v)}` };
  if (!REASONS.includes(data.reason)) return { ok: false, error: "invalid reason" };
  if (!isAbsoluteUrl(data.url)) return { ok: false, error: "invalid url" };
  if (typeof data.html !== "string" || data.html.length === 0) return { ok: false, error: "missing html" };
  if (data.html.length > MAX_PAGE_HTML_LENGTH) return { ok: false, error: "html too large" };
  const { viewport } = data;
  if (
    !isRecord(viewport) ||
    !isFiniteNumber(viewport.x) ||
    !isFiniteNumber(viewport.y) ||
    !isFiniteNumber(viewport.w) ||
    !isFiniteNumber(viewport.h) ||
    !isFiniteNumber(viewport.dpr) ||
    viewport.w <= 0 ||
    viewport.h <= 0 ||
    viewport.dpr <= 0
  ) {
    return { ok: false, error: "invalid viewport" };
  }
  return {
    ok: true,
    payload: {
      type: MSG_PAGE,
      v: PROTOCOL_VERSION,
      reason: data.reason as HandoffReason,
      url: data.url,
      html: data.html,
      viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h, dpr: viewport.dpr },
    },
  };
}
