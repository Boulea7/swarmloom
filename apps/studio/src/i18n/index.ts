import { STUDIO_LOCALES, type StudioLocale } from "../settings";
import { formatMessage, type Message, type Vars } from "./format";
import { en, type StudioCatalog, type StudioKey } from "./messages/en";
import { zhCN } from "./messages/zh-CN";

export type { StudioKey } from "./messages/en";

/** Core's i18n shape (core-internal.ts `I18n`); used for toolbar, format and shared error strings. */
export interface CoreI18n {
  readonly locale: string;
  t(key: string, vars?: Record<string, string | number>): string;
}

/** Studio translator: Studio keys first, then core keys, then English, then the key itself. */
export interface StudioI18n {
  readonly locale: StudioLocale;
  t(key: StudioKey, vars?: Vars): string;
  /** Core-owned keys such as `format.pdf`; returns `fallback` when core has no translation. */
  core(key: string, fallback: string, vars?: Vars): string;
}

/**
 * Translated short name of a format, e.g. "PDF" or "Markdown". Studio's catalog names the formats
 * core does not translate yet; core names the rest, falling back to `meta.label`.
 */
export function formatName(i18n: StudioI18n, meta: { readonly id: string; readonly label: string }): string {
  const key = `format.${meta.id}`;
  return Object.hasOwn(en, key) ? i18n.t(key as StudioKey) : i18n.core(key, meta.label);
}

/** Used when nothing is known about the user's languages. */
export const DEFAULT_LOCALE: StudioLocale = "zh-CN";
/** Used when the user's languages are known but none is supported. */
export const FALLBACK_LOCALE: StudioLocale = "en";

/** Native names for the language menu (never translated). */
export const LOCALE_NAMES: Readonly<Record<StudioLocale, string>> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
};

const TAG_SHAPE = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;
const TRADITIONAL = new Set(["tw", "hk", "mo", "hant"]);

/** Maps one BCP 47 tag to a supported locale, or null. `zh-Hant`/`zh-TW`/`zh-HK` read Traditional. */
export function matchLocale(tag: string): StudioLocale | null {
  const normalized = tag.trim().replace(/_/g, "-");
  if (!TAG_SHAPE.test(normalized)) return null;
  const lower = normalized.toLowerCase();
  const exact = STUDIO_LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  const [language, ...rest] = lower.split("-");
  if (language === "zh") {
    if (rest.includes("hans")) return "zh-CN";
    return rest.some((part) => TRADITIONAL.has(part)) ? "zh-TW" : "zh-CN";
  }
  return STUDIO_LOCALES.find((l) => l === language) ?? null;
}

/**
 * Picks the best supported locale for an ordered preference list (e.g. `navigator.languages`).
 * No information at all yields {@link DEFAULT_LOCALE}; unsupported languages yield {@link FALLBACK_LOCALE}.
 */
export function negotiateLocale(preferred: readonly unknown[] | undefined): StudioLocale {
  const tags = (preferred ?? []).filter((t): t is string => typeof t === "string" && t.trim() !== "");
  if (tags.length === 0) return DEFAULT_LOCALE;
  for (const tag of tags) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return FALLBACK_LOCALE;
}

// English and Simplified Chinese ship in the main chunk; the rest load on demand.
const LOADERS: Record<StudioLocale, () => Promise<StudioCatalog>> = {
  "zh-CN": async () => zhCN,
  en: async () => en,
  "zh-TW": () => import("./messages/zh-TW").then((m) => m.zhTW),
  ja: () => import("./messages/ja").then((m) => m.ja),
  ko: () => import("./messages/ko").then((m) => m.ko),
  es: () => import("./messages/es").then((m) => m.es),
  fr: () => import("./messages/fr").then((m) => m.fr),
  de: () => import("./messages/de").then((m) => m.de),
};

/** A loaded catalog and the locale it is for. */
export interface LoadedCatalog {
  /** The requested locale, or {@link FALLBACK_LOCALE} when its strings could not be loaded. */
  locale: StudioLocale;
  catalog: StudioCatalog;
}

/**
 * Loads a catalog. A failed chunk load (offline) falls back to English rather than breaking the
 * UI, and says so in `locale`, so the page and core strings switch to English with it.
 */
export async function loadCatalog(locale: StudioLocale): Promise<LoadedCatalog> {
  try {
    return { locale, catalog: await LOADERS[locale]() };
  } catch (error) {
    console.warn(`[studio] could not load the ${locale} strings, using English`, error);
    return { locale: FALLBACK_LOCALE, catalog: en };
  }
}

/**
 * Creates the translator for a loaded catalog.
 *
 * @param locale Resolved Studio locale.
 * @param catalog Catalog for `locale` (from {@link loadCatalog}, which may fall back to English).
 * @param core Core's i18n for the same locale, or null when core does not provide one yet.
 */
export function createStudioI18n(locale: StudioLocale, catalog: StudioCatalog, core: CoreI18n | null): StudioI18n {
  const pick = (message: Message | undefined, fallback: Message, vars?: Vars): string =>
    formatMessage(locale, message ?? fallback, vars);
  return {
    locale,
    t: (key, vars) => pick(catalog[key], en[key] ?? key, vars),
    core: (key, fallback, vars) => {
      const translated = core?.t(key, vars);
      if (translated !== undefined && translated !== key) return translated;
      return formatMessage(locale, fallback, vars);
    },
  };
}
