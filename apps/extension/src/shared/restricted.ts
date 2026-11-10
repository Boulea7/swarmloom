/**
 * Decides what a toolbar click should do with a tab URL: inject the swarm, hand a document to
 * Studio, or explain why the page is off limits. Pure functions, no extension API access.
 */

import type { Engine } from "./build-info";
import type { FileAccessState } from "./capabilities";

export type BlockReason =
  | "browser-page"
  | "store"
  | "extension-page"
  | "pdf"
  | "view-source"
  | "file-access"
  | "file-unsupported"
  | "blocked";

export const BLOCK_REASONS: readonly BlockReason[] = [
  "browser-page",
  "store",
  "extension-page",
  "pdf",
  "view-source",
  "file-access",
  "file-unsupported",
  "blocked",
];

export type PageVerdict =
  /** Normal web page (or unknown URL): inject the content script. */
  | { kind: "page" }
  /** One of SwarmLoom's own pages; the demo page runs the swarm itself. */
  | { kind: "own-page"; page: "demo" | "other" }
  /** A document the browser renders natively (PDF): open it in Studio instead. */
  | { kind: "document"; url: string }
  | { kind: "restricted"; reason: BlockReason; url?: string };

export interface ClassifyContext {
  /** `runtime.getURL("")`, e.g. "chrome-extension://abc/". */
  extensionOrigin: string;
  engine: Engine;
  fileAccess: FileAccessState;
}

/** Privileged schemes no extension may script, in any engine. */
const BROWSER_SCHEMES = new Set([
  "about:",
  "blob:",
  "brave:",
  "chrome:",
  "chrome-native:",
  "chrome-search:",
  "chrome-untrusted:",
  "data:",
  "devtools:",
  "edge:",
  "filesystem:",
  "javascript:",
  "opera:",
  "resource:",
  "safari-resource:",
  "vivaldi:",
]);

const EXTENSION_SCHEMES = new Set(["chrome-extension:", "moz-extension:", "safari-web-extension:", "extension:"]);

/** Store and account hosts the engines refuse to script (enterprise policy may add more). */
const STORE_HOSTS: Readonly<Record<Engine, readonly string[]>> = {
  chromium: ["chromewebstore.google.com", "microsoftedge.microsoft.com", "addons.opera.com"],
  gecko: [
    "addons.mozilla.org",
    "discovery.addons.mozilla.org",
    "accounts.firefox.com",
    "support.mozilla.org",
    "install.mozilla.org",
  ],
  webkit: [],
};

function isStore(url: URL, engine: Engine): boolean {
  if (STORE_HOSTS[engine].includes(url.hostname)) return true;
  // The legacy Chrome Web Store path still redirects to a protected page.
  return engine === "chromium" && url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore");
}

function isPdfPath(url: URL): boolean {
  return url.pathname.toLowerCase().endsWith(".pdf");
}

function readerTarget(url: URL): string | undefined {
  const inner = url.searchParams.get("url");
  return inner && /^https?:/i.test(inner) ? inner : undefined;
}

/** Classifies the URL of the tab the user acted on. */
export function classifyUrl(raw: string | undefined, ctx: ClassifyContext): PageVerdict {
  if (!raw) return { kind: "page" };
  if (ctx.extensionOrigin && raw.startsWith(ctx.extensionOrigin)) {
    const path = raw.slice(ctx.extensionOrigin.length).split(/[?#]/)[0];
    return { kind: "own-page", page: path === "demo.html" ? "demo" : "other" };
  }
  if (/^view-source:/i.test(raw)) {
    return { kind: "restricted", reason: "view-source", url: raw.slice("view-source:".length) };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "restricted", reason: "browser-page" };
  }
  const scheme = url.protocol;
  if (scheme === "about:" && url.pathname === "reader") {
    return { kind: "restricted", reason: "view-source", url: readerTarget(url) };
  }
  if (EXTENSION_SCHEMES.has(scheme)) return { kind: "restricted", reason: "extension-page" };
  if (BROWSER_SCHEMES.has(scheme)) return { kind: "restricted", reason: "browser-page" };
  if (scheme === "file:") {
    if (ctx.fileAccess === "unsupported") return { kind: "restricted", reason: "file-unsupported", url: raw };
    if (ctx.fileAccess === "denied") return { kind: "restricted", reason: "file-access", url: raw };
    return isPdfPath(url) ? { kind: "document", url: raw } : { kind: "page" };
  }
  if (scheme !== "http:" && scheme !== "https:") return { kind: "restricted", reason: "browser-page" };
  if (isStore(url, ctx.engine)) return { kind: "restricted", reason: "store", url: raw };
  if (isPdfPath(url)) return { kind: "document", url: raw };
  return { kind: "page" };
}

/** Maps an injection failure to a reason shown to the user. */
export function classifyInjectionError(message: string, url: string | undefined): BlockReason {
  if (url?.startsWith("file:") || /file:\/\/|file url|file scheme/i.test(message)) return "file-access";
  if (/gallery|web ?store|addons/i.test(message)) return "store";
  if (/pdf/i.test(message)) return "pdf";
  // Chromium names the scheme ("Cannot access a chrome:// URL") when the tab URL itself is hidden.
  for (const [, scheme] of message.matchAll(/\b([a-z][a-z-]*:)\/\//gi)) {
    const s = (scheme ?? "").toLowerCase();
    if (EXTENSION_SCHEMES.has(s)) return "extension-page";
    if (BROWSER_SCHEMES.has(s)) return "browser-page";
  }
  return "blocked";
}

/** Message key of the human readable explanation of a reason. */
export function reasonMessageKey(
  reason: BlockReason,
):
  | "reasonBrowserPage"
  | "reasonStore"
  | "reasonExtensionPage"
  | "reasonPdf"
  | "reasonViewSource"
  | "reasonFileAccess"
  | "reasonFileUnsupported"
  | "reasonBlocked" {
  switch (reason) {
    case "browser-page":
      return "reasonBrowserPage";
    case "store":
      return "reasonStore";
    case "extension-page":
      return "reasonExtensionPage";
    case "pdf":
      return "reasonPdf";
    case "view-source":
      return "reasonViewSource";
    case "file-access":
      return "reasonFileAccess";
    case "file-unsupported":
      return "reasonFileUnsupported";
    default:
      return "reasonBlocked";
  }
}

export function isBlockReason(value: unknown): value is BlockReason {
  return typeof value === "string" && (BLOCK_REASONS as readonly string[]).includes(value);
}
