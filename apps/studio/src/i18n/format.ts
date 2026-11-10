/** A message: plain text, or plural forms selected by the `count` variable. */
export type Message = string | ({ other: string } & Partial<Record<Intl.LDMLPluralRule, string>>);

export type Vars = Record<string, string | number>;

const pluralCache = new Map<string, Intl.PluralRules>();

function pluralRules(locale: string): Intl.PluralRules {
  let rules = pluralCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralCache.set(locale, rules);
  }
  return rules;
}

const numberCache = new Map<string, Intl.NumberFormat>();

function formatNumber(locale: string, value: number): string {
  let format = numberCache.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberCache.set(locale, format);
  }
  return format.format(value);
}

/**
 * Formats a message: picks the plural form for `vars.count` and replaces `{name}` placeholders.
 * Numbers are formatted for the locale; unknown placeholders are left as they are.
 */
export function formatMessage(locale: string, message: Message, vars?: Vars): string {
  let text: string;
  if (typeof message === "string") {
    text = message;
  } else {
    const count = typeof vars?.count === "number" ? vars.count : Number(vars?.count ?? Number.NaN);
    const form = Number.isFinite(count) ? pluralRules(locale).select(count) : "other";
    text = message[form] ?? message.other;
  }
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(locale, value) : value;
  });
}
