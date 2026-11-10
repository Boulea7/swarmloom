/**
 * UI strings for SwarmLoom in eight locales.
 *
 * `createI18n(locale?)` negotiates a supported locale (exact -> language -> en; navigator.languages
 * when no argument is given; zh-CN when there is no locale information at all) and returns a
 * translator. A key missing from the chosen catalog falls back to English, then to the key itself,
 * so a typo is visible instead of rendering an empty control.
 */

import type { I18n } from "../internal";
import { createFormatter, type Message, type MessageVars } from "./format";
import { LOCALES, type Locale, navigatorLanguages, resolveLocale } from "./locale";
import { de } from "./messages/de";
import { type Catalog, en, type MessageKey } from "./messages/en";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { ja } from "./messages/ja";
import { ko } from "./messages/ko";
import { zhCN } from "./messages/zh-CN";
import { zhTW } from "./messages/zh-TW";

export type { Message, MessageVars, PluralMessage } from "./format";
export type { Locale } from "./locale";
export { DEFAULT_LOCALE, FALLBACK_LOCALE, LOCALES, matchLocale, resolveLocale } from "./locale";
export type { Catalog, MessageKey } from "./messages/en";

/** All catalogs by locale. English is the reference key set. */
export const CATALOGS: Readonly<Record<Locale, Catalog>> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
  ja,
  ko,
  es,
  fr,
  de,
};

/** Translator returned by {@link createI18n}; keys are checked at compile time when literal. */
export interface Translator extends I18n {
  readonly locale: Locale;
  t(key: MessageKey | (string & {}), vars?: MessageVars): string;
  /** Locale-aware number formatting (digit grouping, at most two fraction digits). */
  number(value: number): string;
  /** True when the key exists in the English reference catalog. */
  has(key: string): key is MessageKey;
}

const ENGLISH: Readonly<Record<string, Message>> = en;

function lookup(catalog: Readonly<Record<string, Message>>, key: string): Message | undefined {
  return Object.hasOwn(catalog, key) ? catalog[key] : undefined;
}

/**
 * Creates a translator.
 *
 * @param locale BCP 47 tag such as "zh-Hant-HK" or "en-GB". Omit to use navigator.languages.
 * @example
 * const i18n = createI18n("fr-CA");
 * i18n.t("progress.layers", { built: 3, count: 12 }); // "3 sur 12 calques"
 */
export function createI18n(locale?: string): Translator {
  const resolved = resolveLocale(locale ?? navigatorLanguages());
  const catalog: Readonly<Record<string, Message>> = CATALOGS[resolved];
  const formatter = createFormatter(resolved);

  return {
    locale: resolved,
    number: formatter.number,
    has: (key): key is MessageKey => Object.hasOwn(ENGLISH, key),
    t(key, vars) {
      const message = lookup(catalog, key) ?? lookup(ENGLISH, key);
      return message === undefined ? key : formatter.format(message, vars);
    },
  };
}

/** Type guard for supported locale ids. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
