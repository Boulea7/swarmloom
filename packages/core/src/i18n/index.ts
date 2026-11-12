/**
 * UI strings for SwarmLoom in eight locales.
 *
 * `createI18n(locale?)` negotiates a supported locale (exact -> language -> en; navigator.languages
 * when no argument is given; zh-CN when there is no locale information at all) and returns a
 * translator. A key missing from the chosen catalog falls back to English, then to the key itself,
 * so a typo is visible instead of rendering an empty control. Messages a host passes in (the
 * player's `messages` option) come before the catalog.
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

/**
 * All catalogs by locale. English is the reference key set. A host can send one of them to a
 * bundle that leaves the others out, as `PlayerOptions.messages`.
 */
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

/** Text, or plural forms that are all text and include `other`. */
function isMessage(value: unknown): value is Message {
  if (typeof value === "string") return true;
  if (typeof value !== "object" || value === null) return false;
  const forms = Object.values(value);
  return typeof (value as { other?: unknown }).other === "string" && forms.every((f) => typeof f === "string");
}

/** The well-formed own entries of host-supplied messages. */
function ownMessages(messages: unknown): Readonly<Record<string, Message>> {
  if (typeof messages !== "object" || messages === null) return {};
  return Object.fromEntries(Object.entries(messages).filter(([, m]) => isMessage(m)));
}

/**
 * Creates a translator.
 *
 * @param locale BCP 47 tag such as "zh-Hant-HK" or "en-GB". Omit to use navigator.languages.
 * @param messages Optional strings for that locale, keyed like the catalogs. They come before the
 *   built-in catalog; malformed entries are ignored.
 * @example
 * const i18n = createI18n("fr-CA");
 * i18n.t("progress.layers", { built: 3, count: 12 }); // "3 sur 12 calques"
 */
export function createI18n(locale?: string, messages?: Readonly<Record<string, Message>>): Translator {
  const resolved = resolveLocale(locale ?? navigatorLanguages());
  const catalog: Readonly<Record<string, Message>> = CATALOGS[resolved];
  const own = ownMessages(messages);
  const formatter = createFormatter(resolved);

  return {
    locale: resolved,
    number: formatter.number,
    has: (key): key is MessageKey => Object.hasOwn(ENGLISH, key),
    t(key, vars) {
      const message = lookup(own, key) ?? lookup(catalog, key) ?? lookup(ENGLISH, key);
      return message === undefined ? key : formatter.format(message, vars);
    },
  };
}

/** Type guard for supported locale ids. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
