/**
 * Message formatting: `{name}` interpolation and plural selection.
 *
 * A message is either a plain string or a set of plural forms keyed by CLDR plural category.
 * Plural messages select on the numeric `count` variable through Intl.PluralRules; a missing
 * category falls back to `other`. Numbers are formatted with the locale's digit grouping.
 */

/** Plural forms keyed by CLDR category; `other` is mandatory. */
export type PluralMessage = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;

export type Message = string | PluralMessage;

export type MessageVars = Record<string, string | number>;

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Formatter bound to one locale; caches Intl objects so `t()` allocates little per call. */
export interface MessageFormatter {
  format(message: Message, vars?: MessageVars): string;
  number(value: number): string;
}

export function createFormatter(locale: string): MessageFormatter {
  const plurals = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  const number = (value: number): string => (Number.isFinite(value) ? numbers.format(value) : String(value));

  const interpolate = (text: string, vars: MessageVars | undefined): string => {
    if (!vars || text.indexOf("{") < 0) return text;
    return text.replace(PLACEHOLDER, (whole, name: string) => {
      if (!Object.hasOwn(vars, name)) return whole;
      const value = vars[name];
      return typeof value === "number" ? number(value) : String(value);
    });
  };

  return {
    number,
    format(message, vars) {
      if (typeof message === "string") return interpolate(message, vars);
      const count = vars?.count;
      const category = typeof count === "number" && Number.isFinite(count) ? plurals.select(count) : "other";
      return interpolate(message[category] ?? message.other, vars);
    },
  };
}
