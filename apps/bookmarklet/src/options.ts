import type { LabelMode } from "@swarmloom/core";

/**
 * Rebuild options a bookmarklet carries in its `data-swarmloom-bm` attribute.
 *
 * Wire format: `key=value` pairs joined by `&` (e.g. `speed=2&sound=0`), which costs far fewer
 * URL bytes than JSON. Unknown keys are ignored so older bundles accept newer bookmarklets;
 * invalid values are dropped and reported, never fatal.
 */
export interface BookmarkletOptions {
  /** Build speed multiplier, 0.25..4. */
  speed?: number;
  /** Sound effects on or off. */
  sound?: boolean;
  /** Number of cursors (1..64) or "auto". */
  agents?: number | "auto";
  labels?: LabelMode;
  finale?: "flock" | "halo" | "none";
  theme?: "auto" | "light" | "dark";
  follow?: "scroll" | "tour" | "none";
  /** BCP 47 language tag for the toolbar. */
  locale?: string;
  /** Seed for the choreography; the bundle derives one from the page URL when absent. */
  seed?: number;
}

/** Result of {@link parseOptions}: the valid options plus one message per rejected entry. */
export interface ParsedOptions {
  options: BookmarkletOptions;
  problems: string[];
}

type Parser = (raw: string) => unknown;

function oneOf<T extends string>(...values: T[]): Parser {
  return (raw) => (values.includes(raw as T) ? raw : undefined);
}

function numberIn(min: number, max: number, integer: boolean): Parser {
  return (raw) => {
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return undefined;
    const n = Number(raw);
    if (integer && !Number.isInteger(n)) return undefined;
    return n >= min && n <= max ? n : undefined;
  };
}

const agentsCount = numberIn(1, 64, true);
const seedValue = numberIn(0, 2 ** 32 - 1, true);

const PARSERS: Record<keyof BookmarkletOptions, Parser> = {
  speed: numberIn(0.25, 4, false),
  sound: (raw) => (raw === "1" ? true : raw === "0" ? false : undefined),
  agents: (raw) => (raw === "auto" ? raw : agentsCount(raw)),
  labels: oneOf<LabelMode>("names", "agents", "roles", "none"),
  finale: oneOf("flock", "halo", "none"),
  theme: oneOf("auto", "light", "dark"),
  follow: oneOf("scroll", "tour", "none"),
  locale: (raw) => (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(raw) ? raw : undefined),
  seed: seedValue,
};

function isOptionKey(key: string): key is keyof BookmarkletOptions {
  return Object.hasOwn(PARSERS, key);
}

/** Upper bound on the option string a bundle accepts, in characters. */
export const MAX_OPTIONS_LENGTH = 512;

/**
 * Parses the option string from the `data-swarmloom-bm` attribute. Never throws.
 *
 * @param raw Attribute value; null/undefined/empty mean "all defaults".
 */
export function parseOptions(raw: string | null | undefined): ParsedOptions {
  const options: Record<string, unknown> = {};
  const problems: string[] = [];
  if (!raw) return { options, problems };
  if (raw.length > MAX_OPTIONS_LENGTH) return { options, problems: ["options string too long"] };
  for (const [key, value] of new URLSearchParams(raw)) {
    if (!isOptionKey(key)) continue;
    const parsed = PARSERS[key](value);
    if (parsed === undefined) problems.push(`invalid ${key}: ${JSON.stringify(value.slice(0, 32))}`);
    else options[key] = parsed;
  }
  return { options: options as BookmarkletOptions, problems };
}

/**
 * Formats options for a bookmarklet, omitting undefined entries.
 * The output only contains `[A-Za-z0-9=&.-]`, so it is safe in a `javascript:` URL as is.
 *
 * @throws RangeError when a value would not survive {@link parseOptions}.
 */
export function formatOptions(options: BookmarkletOptions): string {
  const parts: string[] = [];
  for (const key of Object.keys(PARSERS) as (keyof BookmarkletOptions)[]) {
    const value = options[key];
    if (value === undefined) continue;
    const text = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    if (PARSERS[key](text) === undefined) throw new RangeError(`invalid bookmarklet option ${key}=${text}`);
    parts.push(`${key}=${text}`);
  }
  return parts.join("&");
}
