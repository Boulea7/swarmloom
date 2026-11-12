import { matchLocale } from "./i18n";
import { type StudioSettings, sanitizeSettings } from "./settings";

/** Where the content being played comes from. Only some kinds survive a reload (see {@link restorable}). */
export type SourceRef =
  /** A bundled example, by manifest id. */
  | { kind: "example"; id: string }
  /** A remote file or page. */
  | { kind: "url"; url: string }
  /** Text compressed into the URL hash (`#d=`). */
  | { kind: "shared"; payload: string }
  /** Files or text received through the PWA share target, held by the service worker. */
  | { kind: "inbox"; id: string }
  /** Files passed by the OS through `file_handlers` (Launch Queue API). */
  | { kind: "launch" }
  /** Input handed over by the browser extension through extension storage. */
  | { kind: "stored"; key: string }
  /** A local file opened in this session; its bytes are gone after a reload. */
  | { kind: "file"; name: string }
  /** A page copy posted by the bookmarklet from `window.opener` (`?from=bookmarklet`). */
  | { kind: "handoff" };

export interface Route {
  /** null renders the home view. */
  source: SourceRef | null;
  autoplay: boolean;
  /** Watch player mode (`?watch=1`); small viewports switch to it on their own. */
  watch: boolean;
  /** Round-safe inscribed layout for round watch faces (`?round=1`). */
  round: boolean;
  /** Ask the home view to highlight its file picker (`?import=1`, sent by the extension). */
  import: boolean;
  /** Settings overridden for this visit only (never persisted). */
  overrides: Partial<StudioSettings>;
}

export interface RouteOptions {
  /** Allow `file:` sources (extension pages may read local files the user granted access to). */
  allowFileUrls?: boolean;
}

/** Longest `#d=` payload accepted, in characters. */
export const MAX_HASH_PAYLOAD = 64 * 1024;

const EXAMPLE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const INBOX_ID = /^[a-z0-9-]{8,64}$/i;
const STORAGE_KEY = /^[\w.:-]{1,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function flag(params: URLSearchParams, name: string): boolean {
  const value = params.get(name);
  return value !== null && value !== "0" && value !== "false";
}

/**
 * Validates a remote source URL. Only http(s) (and `file:` when allowed) are accepted, so
 * `javascript:`, `data:` and similar schemes can never be passed in through a link.
 *
 * @returns The absolute URL, or null when it is not acceptable.
 */
export function normalizeSourceUrl(raw: string, base: string, opts: RouteOptions = {}): string | null {
  const text = raw.trim();
  if (text === "" || text.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(text, base);
  } catch {
    return null;
  }
  const allowed =
    url.protocol === "https:" || url.protocol === "http:" || (opts.allowFileUrls && url.protocol === "file:");
  if (!allowed) return null;
  if (url.username || url.password) return null;
  return url.href;
}

function parseSource(url: URL, opts: RouteOptions): SourceRef | null {
  const p = url.searchParams;
  const hash = new URLSearchParams(url.hash.slice(1));
  const payload = hash.get("d");
  if (payload !== null) {
    // A damaged payload still routes to the player, which explains what went wrong.
    return { kind: "shared", payload: payload.length <= MAX_HASH_PAYLOAD && BASE64URL.test(payload) ? payload : "" };
  }
  const example = p.get("example");
  if (example !== null) return EXAMPLE_ID.test(example) ? { kind: "example", id: example } : null;
  const src = p.get("src");
  if (src !== null) {
    const normalized = normalizeSourceUrl(src, url.href, opts);
    return normalized ? { kind: "url", url: normalized } : null;
  }
  const inbox = p.get("inbox");
  if (inbox !== null) return INBOX_ID.test(inbox) ? { kind: "inbox", id: inbox } : null;
  const key = p.get("key");
  if (key !== null) return STORAGE_KEY.test(key) ? { kind: "stored", key } : null;
  if (flag(p, "launch")) return { kind: "launch" };
  if (p.get("from") === "bookmarklet") return { kind: "handoff" };
  const file = p.get("file");
  if (file !== null) return { kind: "file", name: file.slice(0, 200) };
  return null;
}

/** Maps short URL parameter names to settings fields, then validates them. */
function parseOverrides(p: URLSearchParams): Partial<StudioSettings> {
  const raw: Record<string, unknown> = {};
  const map: Record<string, keyof StudioSettings> = {
    agents: "agents",
    speed: "speed",
    seed: "seed",
    labels: "labels",
    theme: "theme",
    finale: "finale",
    intro: "intro",
    follow: "follow",
    opening: "opening",
    "live-top": "liveTop",
    motion: "reducedMotion",
    sound: "sound",
    pack: "soundPack",
  };
  for (const [param, field] of Object.entries(map)) {
    const value = p.get(param);
    if (value !== null) raw[field] = value;
  }
  const lang = p.get("lang");
  if (lang !== null) raw.locale = matchLocale(lang) ?? undefined;
  return sanitizeSettings(raw);
}

/**
 * Parses a Studio URL into a route. Unknown or invalid parameters are ignored, never thrown.
 *
 * Supported: `?example=<id>`, `?src=<url>`, `#d=<payload>`, `?inbox=<id>`, `?key=<storage key>`,
 * `?launch=1`, `?from=bookmarklet`, `?import=1`, `?autoplay=1`, `?watch=1`, `?round=1`, plus setting overrides `agents`, `speed`,
 * `seed`, `labels`, `theme`, `finale`, `intro`, `follow`, `opening`, `live-top`, `motion`, `sound`, `pack` and `lang`.
 */
export function parseRoute(href: string, opts: RouteOptions = {}): Route {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { source: null, autoplay: false, watch: false, round: false, import: false, overrides: {} };
  }
  const p = url.searchParams;
  const round = flag(p, "round");
  return {
    source: parseSource(url, opts),
    autoplay: flag(p, "autoplay"),
    watch: flag(p, "watch") || round,
    round,
    import: flag(p, "import"),
    overrides: parseOverrides(p),
  };
}

/** Short URL parameters for settings, the inverse of the parser's map. */
const OVERRIDE_PARAMS: ReadonlyArray<[keyof StudioSettings, string]> = [
  ["agents", "agents"],
  ["speed", "speed"],
  ["seed", "seed"],
  ["labels", "labels"],
  ["theme", "theme"],
  ["finale", "finale"],
  ["intro", "intro"],
  ["follow", "follow"],
  ["opening", "opening"],
  ["liveTop", "live-top"],
  ["reducedMotion", "motion"],
  ["sound", "sound"],
  ["soundPack", "pack"],
  ["locale", "lang"],
];

/**
 * Builds the URL for a route relative to the app base (`base` is the absolute app URL ending in `/`).
 * `#d=` payloads go into the hash so they never reach a server log.
 */
export function routeToUrl(route: Partial<Route>, base: string): string {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  const p = url.searchParams;
  const source = route.source ?? null;
  switch (source?.kind) {
    case "example":
      p.set("example", source.id);
      break;
    case "url":
      p.set("src", source.url);
      break;
    case "inbox":
      p.set("inbox", source.id);
      break;
    case "stored":
      p.set("key", source.key);
      break;
    case "launch":
      p.set("launch", "1");
      break;
    case "file":
      p.set("file", source.name);
      break;
    case "handoff":
      p.set("from", "bookmarklet");
      break;
    default:
      break;
  }
  if (route.autoplay) p.set("autoplay", "1");
  if (route.import) p.set("import", "1");
  if (route.round) p.set("round", "1");
  else if (route.watch) p.set("watch", "1");
  for (const [field, param] of OVERRIDE_PARAMS) {
    const value = route.overrides?.[field];
    if (value !== undefined) p.set(param, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  if (source?.kind === "shared") url.hash = `d=${source.payload}`;
  return url.href;
}

/** True when a source can be reopened from its URL alone (after a reload or on another device). */
export function restorable(source: SourceRef): boolean {
  return source.kind === "example" || source.kind === "url" || source.kind === "shared";
}
