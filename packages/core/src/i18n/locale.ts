/**
 * Locale negotiation for SwarmLoom UI strings.
 *
 * Resolution order for one tag: exact match -> same language (with a script/region rule for
 * Chinese) -> no match. A list of tags (navigator.languages) is tried in order; when none of them
 * matches, English is used. When no locale information exists at all, Simplified Chinese is used.
 */

/** Every locale with a complete message catalog. */
export const LOCALES = ["zh-CN", "zh-TW", "en", "ja", "ko", "es", "fr", "de"] as const;

export type Locale = (typeof LOCALES)[number];

/** Used when there is no locale information at all (no argument, no navigator languages). */
export const DEFAULT_LOCALE: Locale = "zh-CN";

/** Used when locale information exists but none of it is supported. */
export const FALLBACK_LOCALE: Locale = "en";

const BY_LOWER: ReadonlyMap<string, Locale> = new Map(LOCALES.map((l) => [l.toLowerCase(), l]));

/** Regions and scripts that read Traditional Chinese. */
const TRADITIONAL_REGIONS = new Set(["tw", "hk", "mo"]);

/** BCP 47 shape check: alphanumeric subtags of 1..8 characters separated by hyphens. */
const TAG_SHAPE = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;

/**
 * Maps one BCP 47 tag (or a POSIX-style tag such as `zh_TW`) to a supported locale.
 *
 * @returns The supported locale, or null when the tag is malformed or its language is unsupported.
 */
export function matchLocale(tag: string): Locale | null {
  const normalized = tag.trim().replace(/_/g, "-");
  if (!TAG_SHAPE.test(normalized)) return null;
  const lower = normalized.toLowerCase();
  const exact = BY_LOWER.get(lower);
  if (exact) return exact;

  const [language, ...rest] = lower.split("-");
  if (language === "zh") return chineseVariant(rest);
  for (const locale of LOCALES) {
    if (locale === language) return locale;
  }
  return null;
}

/** zh-Hant-* and zh-{TW,HK,MO} read Traditional; everything else (zh, zh-Hans-*, zh-SG...) Simplified. */
function chineseVariant(subtags: readonly string[]): Locale {
  const script = subtags.find((s) => s.length === 4 && /^[a-z]+$/.test(s));
  if (script === "hant") return "zh-TW";
  if (script === "hans") return "zh-CN";
  const region = subtags.find((s) => s.length === 2 && /^[a-z]+$/.test(s));
  return region && TRADITIONAL_REGIONS.has(region) ? "zh-TW" : "zh-CN";
}

/**
 * Picks the best supported locale for a preference list.
 *
 * @param preferred One tag or an ordered list (e.g. navigator.languages). Non-string entries are ignored.
 * @returns The first match in order; {@link FALLBACK_LOCALE} when nothing matches;
 *   {@link DEFAULT_LOCALE} when the list is empty.
 */
export function resolveLocale(preferred: string | readonly unknown[] | undefined): Locale {
  const tags = (typeof preferred === "string" ? [preferred] : (preferred ?? [])).filter(
    (t): t is string => typeof t === "string" && t.trim() !== "",
  );
  if (tags.length === 0) return DEFAULT_LOCALE;
  for (const tag of tags) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return FALLBACK_LOCALE;
}

/** The browser's preference list, or an empty list outside browsers (SSR, workers without navigator). */
export function navigatorLanguages(): readonly string[] {
  const nav = (globalThis as { navigator?: Partial<Navigator> }).navigator;
  if (!nav) return [];
  if (Array.isArray(nav.languages) && nav.languages.length > 0) return nav.languages;
  return typeof nav.language === "string" ? [nav.language] : [];
}
