/*
 * Rules are read from their text (`cssText`), never through `style`: the in-browser exporter wraps
 * that getter (watchSheetEdits) to hand each declaration read to its still check, which would then
 * compare the text of every declaration of the page on each frame after go live.
 */

/**
 * A declaration of a keyframe property whose seeked value can start animations elsewhere, in the
 * text of a `@keyframes` rule: an element that is rendered again starts its CSS animations, and a
 * custom property can feed `animation-name`, `display` or a transition through `var()`.
 */
const STARTING_KEYFRAME_DECLARATION = /[{;]\s*(?:--|(?:display|content-visibility)\s*:)/i;
/**
 * A transition declaration that can set a duration or a delay, in the text of a rule, which starts
 * each declaration after a `{` or a `;` (or at its start, for declarations nested in a rule): its
 * name and value. A value is cut at a `;` or a brace, and text in a string can match too: either
 * only counts a rule as starting something.
 */
const TRANSITION_DECLARATION = /(?:^|[{;])\s*(transition(?:-duration|-delay)?)\s*:([^;{}]*)/gi;
/** The `!important` that may end a declaration's value in a rule's text. */
const IMPORTANT = /!\s*important\s*$/i;
/** Grouping rules, whose own text is not read: the rules in them are read one by one. */
const GROUPING_RULES = new Set([
  "CSSMediaRule",
  "CSSSupportsRule",
  "CSSLayerBlockRule",
  "CSSScopeRule",
  "CSSStartingStyleRule",
]);
/** The namespace of the element whose inline style parses declarations (in any document). */
const HTML_NS = "http://www.w3.org/1999/xhtml";
/** One plain time of a transition duration or delay list. */
const PLAIN_TIME = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:ms|s)$/i;
/** CSS-wide keywords: each takes a value another rule sets (scanned there) or the initial 0s. */
const CSS_WIDE = /^(?:initial|inherit|unset|revert|revert-layer)$/i;

/** The interface name of a CSSOM object, which works across frames (unlike `instanceof`). */
function kind(rule: CSSRule): string {
  return Object.prototype.toString.call(rule).slice(8, -1);
}

/**
 * Whether a transition duration or delay list can hold a positive time. Anything but plain times
 * and CSS-wide keywords (`var()`, `attr()`, `calc()`, ...) counts as possibly positive.
 */
function mayBePositive(list: string): boolean {
  if (list === "" || CSS_WIDE.test(list.trim())) return false;
  return list.split(",").some((item) => {
    const time = item.trim();
    return !PLAIN_TIME.test(time) || Number.parseFloat(time) > 0;
  });
}

/**
 * Whether a declaration block can give an element a transition that runs: one whose combined
 * duration (duration plus delay) is positive, judged on each list alone. A shorthand with `var()`
 * leaves its longhands empty, so a shorthand without them counts too.
 */
function declaresTransition(style: CSSStyleDeclaration): boolean {
  const duration = style.getPropertyValue("transition-duration");
  const delay = style.getPropertyValue("transition-delay");
  if (duration === "" && delay === "") return style.getPropertyValue("transition") !== "";
  return mayBePositive(duration) || mayBePositive(delay);
}

/**
 * Whether the text of a rule holds a transition declaration that may run, each declaration judged
 * alone: a later one in the same block may set its time back to 0s, which only reads the rule as
 * starting something. `probe` is a detached element's inline style, which parses the value.
 */
function textDeclaresTransition(text: string, probe: CSSStyleDeclaration): boolean {
  for (const [, name, value] of text.matchAll(TRANSITION_DECLARATION)) {
    probe.cssText = "";
    probe.setProperty(name as string, (value as string).replace(IMPORTANT, "").trim());
    // A value cut short may not parse again: it may hold anything.
    if (probe.length === 0 || declaresTransition(probe)) return true;
  }
  return false;
}

/** What the rules of a scope are read with. */
interface Reading {
  /** The sheets read already. */
  seen: Set<CSSStyleSheet>;
  /** See {@link textDeclaresTransition}. */
  probe: CSSStyleDeclaration;
}

/** Whether `rules` let a seek start something; `nested` when the text of a rule holding them was read. */
function rulesStart(rules: CSSRuleList, reading: Reading, nested = false): boolean {
  for (const rule of Array.from(rules)) {
    const type = kind(rule);
    switch (type) {
      case "CSSContainerRule":
        return true;
      case "CSSFontFaceRule":
        // Descriptors only, and reading them would serialise a source that may run to megabytes.
        continue;
      case "CSSKeyframesRule":
        if (STARTING_KEYFRAME_DECLARATION.test(rule.cssText)) return true;
        continue;
      case "CSSImportRule": {
        const sheet = (rule as CSSImportRule).styleSheet;
        if (sheet && sheetStarts(sheet, reading)) return true;
        continue;
      }
    }
    const inner = (rule as Partial<CSSGroupingRule>).cssRules;
    if (nested || GROUPING_RULES.has(type)) {
      if (inner && rulesStart(inner, reading, nested)) return true;
      continue;
    }
    // The text of a style rule holds the rules nested in it too: those are only read for the rules
    // that start something by their kind.
    const text = rule.cssText;
    if (/transition/i.test(text) && textDeclaresTransition(text, reading.probe)) return true;
    if (inner && /@container|keyframes/i.test(text) && rulesStart(inner, reading, true)) return true;
  }
  return false;
}

function sheetStarts(sheet: CSSStyleSheet, reading: Reading): boolean {
  if (reading.seen.has(sheet)) return false;
  reading.seen.add(sheet);
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return true; // A cross-origin sheet cannot be read: it may hold anything.
  }
  return rulesStart(rules, reading);
}

/**
 * Whether seeking animations can start a transition or a CSS animation in `scope` (a document or a
 * shadow root, the scope of its `getAnimations()`), read from its style sheets and inline styles.
 * A seek changes animated values only; that starts something where
 *  - an element has a transition with a positive combined duration (inherited values, em or
 *    container units and `var()` change with the animated ones),
 *  - an `@container` rule applies (a seeked size or custom property now matches, and its rules can
 *    add transitions or animations),
 *  - keyframes animate `display`, `content-visibility` or a custom property (elements are rendered
 *    again, or a `var()` changes an animation name).
 * Cross-origin sheets, which cannot be read, count as starting something. Sheets still loading
 * and sheets or styles added later are not seen.
 */
export function mayStartAnimations(scope: Document | ShadowRoot): boolean {
  const doc = scope.ownerDocument ?? (scope as Document);
  const reading: Reading = { seen: new Set(), probe: doc.createElementNS(HTML_NS, "div").style };
  const sheets = [...Array.from(scope.styleSheets), ...(scope.adoptedStyleSheets ?? [])];
  if (sheets.some((sheet) => sheetStarts(sheet as CSSStyleSheet, reading))) return true;
  const inline = scope.querySelectorAll<HTMLElement>('[style*="transition" i]');
  return Array.from(inline).some((el) => el.style !== undefined && declaresTransition(el.style));
}
