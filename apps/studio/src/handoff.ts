/**
 * Receiver side of the bookmarklet handoff (bookmarklet zone, `apps/bookmarklet/PROTOCOL.md`).
 *
 * The bookmarklet opens Studio with `?from=bookmarklet` when a page blocks its bundle. Studio asks
 * `window.opener` for the page by posting the bare string {@link MSG_PAGE}; the opener answers with a
 * serialized copy of the page. The copy is untrusted markup: it is only ever handed to the html
 * adapter (which renders it without scripts), never inserted into Studio's own DOM.
 */

import { StudioError } from "./errors";

/** Payload version this receiver understands; other versions are ignored. */
export const HANDOFF_VERSION = 1;
/** Request (Studio -> opener, bare string) and answer type (opener -> Studio). */
export const MSG_PAGE = "swarmloom:page";
/** Longest accepted page markup, in UTF-16 code units (the protocol's limit). */
export const MAX_HANDOFF_HTML = 32 * 1024 * 1024;
/** How long to wait for the opener before giving up. */
export const HANDOFF_TIMEOUT_MS = 15_000;

/** The parts of a page message Studio uses. */
export interface HandoffPage {
  /** `document.URL` of the page (informational). */
  url: string;
  /** Origin the message really came from (`MessageEvent.origin`). */
  origin: string;
  /** Page title read from the markup, possibly empty. */
  title: string;
  /** Serialized document, starting with a `<base>` that points at the original page. */
  html: string;
  /** Layout viewport width of the page at capture time, CSS px. */
  width: number;
}

function isAbsoluteUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:";
  } catch {
    return false;
  }
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

const TITLE = /<title[^>]*>([\s\S]{0,1024}?)<\/title>/i;

/** Plain-text `<title>` of serialized markup (entities for the common characters decoded). */
export function titleOfMarkup(html: string): string {
  const raw = TITLE.exec(html.slice(0, 256 * 1024))?.[1] ?? "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Validates untrusted `MessageEvent.data` plus its origin.
 *
 * @returns The page, or null when the message is not a usable page payload.
 */
export function parseHandoff(data: unknown, origin: string): HandoffPage | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== MSG_PAGE || d.v !== HANDOFF_VERSION) return null;
  if (!isAbsoluteUrl(d.url)) return null;
  if (typeof d.html !== "string" || d.html.length === 0 || d.html.length > MAX_HANDOFF_HTML) return null;
  const viewport = d.viewport as Record<string, unknown> | null | undefined;
  if (typeof viewport !== "object" || viewport === null || !positive(viewport.w) || !positive(viewport.h)) return null;
  return {
    url: d.url,
    origin,
    title: titleOfMarkup(d.html),
    html: d.html,
    width: Math.min(Math.round(viewport.w), 4096),
  };
}

/**
 * Asks `window.opener` for the page and resolves with the first valid copy it sends.
 *
 * Only messages whose `source` is the opener are considered. Their origin can be anything, because
 * the bookmarklet runs on any site; the payload is validated and treated as untrusted markup.
 *
 * @throws StudioError("handoff") when there is no opener or nothing valid arrives in time.
 */
export function receiveHandoff(
  win: Window,
  signal?: AbortSignal,
  timeoutMs = HANDOFF_TIMEOUT_MS,
): Promise<HandoffPage> {
  const opener = win.opener as Window | null;
  if (!opener) return Promise.reject(new StudioError("handoff"));
  return new Promise<HandoffPage>((resolve, reject) => {
    const cleanup = () => {
      win.removeEventListener("message", onMessage);
      win.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== opener) return;
      const page = parseHandoff(event.data, event.origin);
      if (!page) return;
      cleanup();
      resolve(page);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = win.setTimeout(() => {
      cleanup();
      reject(new StudioError("handoff"));
    }, timeoutMs);
    win.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      // The request carries no data, so any origin may receive it.
      opener.postMessage(MSG_PAGE, "*");
    } catch (error) {
      cleanup();
      reject(new StudioError("handoff", {}, { cause: error }));
    }
  });
}
