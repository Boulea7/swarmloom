/**
 * Messages between the background, content scripts and extension pages, plus the launch request
 * the background leaves in a tab's isolated world before injecting `swarm.js`.
 * Everything arriving over a channel is parsed here; unknown shapes are dropped.
 */

// Named imports: the bundler keeps only these strings, not the whole catalog, in `swarm.js`.
import {
  errorClose,
  errorEmpty,
  errorFailed,
  errorRetry,
  errorStudio,
  errorTitle,
  statusScanning,
} from "../locales/en.json";
import { type Locale, type MessageKey, matchLocale, type Translator } from "./i18n";
import { type Prefs, sanitizePrefs } from "./prefs";

export const MSG = {
  /** content -> background: capture the visible tab for media posters. Reply: CaptureReply. */
  capture: "swarmloom:capture",
  /** tracker -> background: the user picked an element to rebuild. */
  elementPicked: "swarmloom:element-picked",
  /** content/page -> background: open Studio (content scripts cannot create tabs). */
  openStudio: "swarmloom:open-studio",
  /** background -> demo page: toggle the in-page swarm of that tab. */
  demoToggle: "swarmloom:demo-toggle",
} as const;

export type RuntimeMessage =
  | { type: typeof MSG.capture }
  | { type: typeof MSG.elementPicked }
  | { type: typeof MSG.openStudio; src?: string; importFile?: boolean }
  | { type: typeof MSG.demoToggle; tabId: number };

export type CaptureReply = { ok: true; dataUrl: string } | { ok: false; error: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Parses an incoming runtime message; returns null for anything that is not ours. */
export function parseMessage(value: unknown): RuntimeMessage | null {
  const m = record(value);
  switch (m?.type) {
    case MSG.capture:
      return { type: MSG.capture };
    case MSG.elementPicked:
      return { type: MSG.elementPicked };
    case MSG.openStudio:
      return {
        type: MSG.openStudio,
        src: typeof m.src === "string" ? m.src : undefined,
        importFile: m.importFile === true,
      };
    case MSG.demoToggle:
      return Number.isInteger(m.tabId) ? { type: MSG.demoToggle, tabId: m.tabId as number } : null;
    default:
      return null;
  }
}

const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/;

/** Validates a capture reply; only PNG/JPEG data URLs are accepted. */
export function parseCaptureReply(value: unknown): CaptureReply {
  const r = record(value);
  if (r?.ok === true && typeof r.dataUrl === "string" && IMAGE_DATA_URL.test(r.dataUrl)) {
    return { ok: true, dataUrl: r.dataUrl };
  }
  return { ok: false, error: typeof r?.error === "string" ? r.error : "invalid capture reply" };
}

/** UI strings the content script needs, resolved by the sender in the preferred language. */
export const SESSION_STRING_KEYS = [
  "statusScanning",
  "errorTitle",
  "errorEmpty",
  "errorFailed",
  "errorRetry",
  "errorStudio",
  "errorClose",
] as const satisfies readonly MessageKey[];

export type SessionStrings = Readonly<Record<(typeof SESSION_STRING_KEYS)[number], string>>;

/** English session strings: the fallback when a launch request lacks one. */
const SESSION_FALLBACK: SessionStrings = {
  statusScanning,
  errorTitle,
  errorEmpty,
  errorFailed,
  errorRetry,
  errorStudio,
  errorClose,
};

/** Builds the session strings from a translator. */
export function sessionStrings(t: Translator["t"]): SessionStrings {
  const out: Record<string, string> = {};
  for (const key of SESSION_STRING_KEYS) out[key] = t(key);
  return out as SessionStrings;
}

/**
 * What to rebuild, left by the background in the isolated world before `swarm.js` runs. It carries
 * the resolved preferences and strings so the content bundle needs no storage read and no catalogs.
 */
export interface LaunchRequest {
  /** "page": the whole document. "element": the element stored by the tracker. */
  kind: "page" | "element";
  /** The background can capture the tab (media posters). */
  capture: boolean;
  prefs: Prefs;
  /** Resolved UI locale. */
  locale: Locale;
  strings: SessionStrings;
}

/** Validates a launch request; every field falls back independently (strings fall back to English). */
export function parseLaunch(value: unknown): LaunchRequest {
  const r = record(value);
  const strings = record(r?.strings);
  const out: Record<string, string> = {};
  for (const key of SESSION_STRING_KEYS) {
    const text = strings?.[key];
    out[key] = typeof text === "string" && text.length <= 500 ? text : SESSION_FALLBACK[key];
  }
  return {
    kind: r?.kind === "element" ? "element" : "page",
    capture: r?.capture === true,
    prefs: sanitizePrefs(r?.prefs),
    locale: (typeof r?.locale === "string" && matchLocale(r.locale)) || "en",
    strings: out as SessionStrings,
  };
}

/** Hints from a context menu click used to find the element under the pointer. */
export interface TargetHints {
  srcUrl?: string;
  linkUrl?: string;
  selectionText?: string;
  /** Firefox `menus.getTargetElement` id. */
  targetElementId?: number;
  /** Prompt shown when the element has to be picked by hand. */
  prompt?: string;
}

/** Names of the isolated-world globals shared by the background's injected functions and the content bundles. */
export const GLOBALS = {
  session: "__swarmloomSession",
  launch: "__swarmloomLaunch",
  tracker: "__swarmloomTracker",
  target: "__swarmloomTarget",
} as const;
