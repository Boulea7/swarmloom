/**
 * Extension UI strings in eight languages.
 *
 * The JSON catalogs in src/locales are the single source: pages and the content script bundle them
 * (so the language preference applies everywhere), and scripts/build.mjs turns them into
 * `_locales/<code>/messages.json` for the manifest, menus and store listing.
 */

import de from "../locales/de.json";
import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";
import zhCN from "../locales/zh-CN.json";
import zhTW from "../locales/zh-TW.json";

export const LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export type MessageKey = keyof typeof en;
type Catalog = Record<MessageKey, string>;

const CATALOGS: Readonly<Record<Locale, Catalog>> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  ko,
  es,
  fr,
  de,
};

/** Native names shown in the language picker (never translated). */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
};

const TRADITIONAL = /^zh-(?:hant|tw|hk|mo)\b/;

/**
 * Maps one BCP 47 tag (or a Chrome-style `zh_TW`) to a supported locale, or null.
 * Chinese without a region or script reads as Simplified.
 */
export function matchLocale(tag: string): Locale | null {
  const lower = tag.trim().replace(/_/g, "-").toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/.test(lower)) return null;
  if (lower.startsWith("zh")) return TRADITIONAL.test(lower) ? "zh-TW" : "zh-CN";
  const language = lower.split("-")[0];
  return (LOCALES as readonly string[]).includes(language ?? "") ? (language as Locale) : null;
}

/**
 * Picks the UI locale: an explicit preference wins, then the first supported browser language,
 * then English.
 */
export function resolveLocale(preference: Locale | "auto", languages: readonly string[]): Locale {
  if (preference !== "auto") return preference;
  for (const tag of languages) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return "en";
}

/** Browser languages in preference order, safe in any context. */
export function browserLanguages(): string[] {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  if (nav?.languages?.length) return [...nav.languages];
  return nav?.language ? [nav.language] : [];
}

export interface Translator {
  readonly locale: Locale;
  t(key: MessageKey, vars?: Readonly<Record<string, string | number>>): string;
}

/** Creates a translator; missing keys fall back to English, unknown `{vars}` stay visible. */
export function createTranslator(locale: Locale): Translator {
  const catalog = CATALOGS[locale];
  return {
    locale,
    t(key, vars) {
      const template = catalog[key] ?? en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        Object.hasOwn(vars, name) ? String(vars[name]) : whole,
      );
    },
  };
}

/** Raw catalogs, for the build script and tests. */
export function catalogFor(locale: Locale): Readonly<Catalog> {
  return CATALOGS[locale];
}

/** Chrome `_locales` folder name of a locale ("zh-CN" -> "zh_CN"). */
export function chromeLocaleDir(locale: Locale): string {
  return locale.replace("-", "_");
}
