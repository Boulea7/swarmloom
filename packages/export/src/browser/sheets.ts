/**
 * Which rules a {@link RuleIndex} collects and which nested rule lists it walks into, by
 * `CSSRule.type` (constructor checks would fail across windows; `@layer`, `@container` and other
 * newer rules are 0).
 */
export interface RuleQuery {
  keep(type: number): boolean;
  /** Asked only of rules that have nested rules (`cssRules`). */
  enter(type: number): boolean;
}

/** A rule list as last walked: what it is read from and the rules it held. */
interface Watched {
  owner: CSSStyleSheet | CSSGroupingRule;
  rules: readonly CSSRule[];
}

interface Walked {
  watched: readonly Watched[];
  kept: readonly CSSRule[];
}

/** Whether every watched list still holds the same rules in the same order: one read per rule. */
function unchanged(watched: readonly Watched[]): boolean {
  try {
    for (const { owner, rules } of watched) {
      const list = owner.cssRules;
      if (list.length !== rules.length) return false;
      for (let i = 0; i < rules.length; i++) if (list[i] !== rules[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The rules of style sheets that a pass on every frame needs, each sheet walked once rather than on
 * every frame: rules rarely change during an export, while a walk reads every rule and its nested
 * list (Chromium gives every style rule one, for CSS nesting). A sheet is walked again once a list
 * the walk read no longer holds the same rule objects (`insertRule`, `deleteRule`, `replace()`),
 * which takes one read per rule and no allocation to tell. A nested list that was empty when walked
 * is not watched, so rules added to it later (through the CSSOM, into a style rule or an empty
 * grouping rule) are not seen until the sheet changes otherwise.
 */
export class RuleIndex {
  readonly #query: RuleQuery;
  readonly #walked = new WeakMap<CSSStyleSheet, Walked>();

  constructor(query: RuleQuery) {
    this.#query = query;
  }

  /** The kept rules of `sheet` in order, nested ones included; none while its rules are private. */
  rules(sheet: CSSStyleSheet): readonly CSSRule[] {
    const last = this.#walked.get(sheet);
    if (last && unchanged(last.watched)) return last.kept;
    let top: CSSRuleList;
    try {
      top = sheet.cssRules;
    } catch {
      // Cross-origin sheets keep their rules private, and Firefox's while they load: read again next time.
      return [];
    }
    const watched: Watched[] = [];
    const kept: CSSRule[] = [];
    const walk = (owner: CSSStyleSheet | CSSGroupingRule, list: CSSRuleList): void => {
      const rules = Array.from(list);
      watched.push({ owner, rules });
      for (const rule of rules) {
        const type = rule.type;
        if (this.#query.keep(type)) kept.push(rule);
        if (!("cssRules" in rule) || !this.#query.enter(type)) continue;
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested.length > 0) walk(rule as CSSGroupingRule, nested);
      }
    };
    walk(sheet, top);
    this.#walked.set(sheet, { watched, kept });
    return kept;
  }
}
