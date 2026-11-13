/**
 * Keyframe properties whose seeked value can start animations elsewhere: an element that is
 * rendered again starts its CSS animations, and a custom property can feed `animation-name`,
 * `display` or a transition through `var()`.
 */
const STARTING_KEYFRAME_PROPS = /^(?:--|display$|content-visibility$)/;
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

function keyframesStart(rule: CSSKeyframesRule): boolean {
  for (const frame of Array.from(rule.cssRules)) {
    const style = (frame as CSSKeyframeRule).style;
    for (let i = 0; i < style.length; i++) {
      if (STARTING_KEYFRAME_PROPS.test(style.item(i))) return true;
    }
  }
  return false;
}

function rulesStart(rules: CSSRuleList, seen: Set<CSSStyleSheet>): boolean {
  for (const rule of Array.from(rules)) {
    switch (kind(rule)) {
      case "CSSContainerRule":
        return true;
      case "CSSFontFaceRule":
        // Descriptors only, and reading them would serialise a source that may run to megabytes.
        continue;
      case "CSSKeyframesRule":
        if (keyframesStart(rule as CSSKeyframesRule)) return true;
        continue;
      case "CSSImportRule": {
        const sheet = (rule as CSSImportRule).styleSheet;
        if (sheet && sheetStarts(sheet, seen)) return true;
        continue;
      }
    }
    if ("style" in rule && declaresTransition((rule as CSSStyleRule).style)) return true;
    if ("cssRules" in rule && rulesStart((rule as CSSGroupingRule).cssRules, seen)) return true;
  }
  return false;
}

function sheetStarts(sheet: CSSStyleSheet, seen: Set<CSSStyleSheet>): boolean {
  if (seen.has(sheet)) return false;
  seen.add(sheet);
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return true; // A cross-origin sheet cannot be read: it may hold anything.
  }
  return rulesStart(rules, seen);
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
  const seen = new Set<CSSStyleSheet>();
  const sheets = [...Array.from(scope.styleSheets), ...(scope.adoptedStyleSheets ?? [])];
  if (sheets.some((sheet) => sheetStarts(sheet as CSSStyleSheet, seen))) return true;
  const inline = scope.querySelectorAll<HTMLElement>('[style*="transition" i]');
  return Array.from(inline).some((el) => el.style !== undefined && declaresTransition(el.style));
}
