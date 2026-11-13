/*
 * Whether putting animations into a pose can start others, from the rules of a page: the HTML
 * adapter's capture freeze and the export's go-live seek read the animations again only then.
 *
 * Rules are read from their text (`cssText`), which holds the whole rule: selectors, preludes,
 * declarations and nested rules.
 */

/**
 * Keyframe properties whose seeked value can start an animation with nothing else needed: an
 * element that is rendered again starts its CSS animations, and a custom property can feed
 * `animation-name`, `display`, a transition or a style query through `var()`.
 */
const RENDERING = /^(?:--|display$|content-visibility$)/;
/**
 * Keyframe properties (shorthands or longhands, as a rule's text holds either) that only paint:
 * nothing inherits them and no layout or other computed value depends on them, so their seeked
 * value reaches another element only through an explicit `inherit`.
 */
const PAINT_ONLY =
  /^(?:opacity|background(?:-.+)?|box-shadow|clip-path|clip|(?:-webkit-)?mask(?:-.+)?|outline(?:-color|-style|-width|-offset)?|border(?:-[a-z]+)*-radius|z-index|mix-blend-mode|isolation|object-position|transform-origin|perspective-origin)$/;
/**
 * Keyframe properties that paint only too, but make the element a containing block for positioned
 * descendants and move its scrollable overflow (scrollbars), so they can resize a container.
 */
const CONTAINING = /^(?:transform|translate|rotate|scale|perspective|filter|backdrop-filter|offset(?:-.+)?)$/;
/** Keyframe descriptors that are not animated. */
const NOT_ANIMATED = /^animation-(?:timing-function|composition)$/;
/**
 * A declaration's name in the text of a `@keyframes` rule (after a `{` or a `;`; keyframe selectors
 * are followed by a `{`). Text in a string can match too, which only adds a name.
 */
const KEYFRAME_DECLARATION = /[{;]\s*(--[^\s:;{}]*|-?[a-z][a-z0-9-]*)\s*:/gi;
/**
 * A transition declaration that can set a duration or a delay, in the text of a rule, which starts
 * each declaration after a `{` or a `;`, or a `}` (declarations after a nested rule), or at its
 * start (for declarations nested in a rule): its name and value. A value is cut at a `;` or a brace, and text in a string can match too: either
 * only counts a rule as starting something.
 */
const TRANSITION_DECLARATION = /(?:^|[{};])\s*(transition(?:-duration|-delay)?)\s*:([^;{}]*)/gi;
/** A declaration that can set `container-type`, in the text of a rule (as {@link TRANSITION_DECLARATION}). */
const CONTAINER_DECLARATION = /(?:^|[{};])\s*(container(?:-type)?)\s*:([^;{}]*)/gi;
/** A declaration set to `inherit`, in the text of a rule (as {@link TRANSITION_DECLARATION}): its name. */
const INHERIT_DECLARATION = /(?:^|[{};])\s*([a-z-][a-z0-9-]*)\s*:\s*inherit\s*(?:!\s*important\s*)?(?=[;}]|$)/gi;
/** The `!important` that may end a declaration's value in a rule's text. */
const IMPORTANT = /!\s*important\s*$/i;
/** Grouping rules, whose own text is not read: the rules in them are read one by one. */
const GROUPING_RULES = new Set([
  "CSSMediaRule",
  "CSSSupportsRule",
  "CSSLayerBlockRule",
  "CSSScopeRule",
  "CSSStartingStyleRule",
  "CSSContainerRule",
]);
/** The namespace of the element whose inline style parses declarations (in any document). */
const HTML_NS = "http://www.w3.org/1999/xhtml";
/**
 * One plain time of a transition duration or delay list. Each digit run has one way to match, so a
 * long run that ends in no unit fails in linear time: the text is the page's.
 */
const PLAIN_TIME = /^[+-]?(?=\.?\d)\d*(?:\.\d*)?(?:e[+-]?\d+)?(?:ms|s)$/i;
/** CSS-wide keywords: each takes a value another rule sets (scanned there) or the initial 0s. */
const CSS_WIDE = /^(?:initial|inherit|unset|revert|revert-layer)$/i;

/** What the styles of a scope (a document or a shadow root) hold that lets a seek start something there. */
export interface StyleFacts {
  /** Some element can get a transition that runs: one with a positive duration or delay. */
  transitions: boolean;
  /** Some element can be a size container: `container-type` is set, or an `@container` rule applies. */
  containers: boolean;
  /** Properties that keyframes animate. */
  animated: Set<string>;
  /** Families ({@link family}) of the paint-only properties a declaration sets to `inherit` (`all` for `all: inherit`). */
  inherited: Set<string>;
  /** A cross-origin sheet could not be read: it may hold anything. */
  unreadable: boolean;
}

/** The interface name of a CSSOM object, which works across frames (unlike `instanceof`). */
function kind(rule: CSSRule): string {
  return Object.prototype.toString.call(rule).slice(8, -1);
}

/**
 * The shorthand a paint-only property belongs to, so that a longhand and its shorthand meet (rule
 * text holds either): `background-color` is `background`, `border-top-left-radius` is `border-radius`.
 */
function family(name: string): string {
  return name
    .replace(/^-webkit-/, "")
    .replace(/^(background|mask|outline|offset)-.+$/, "$1")
    .replace(/^border-.+-radius$/, "border-radius");
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
 * Whether a declaration block can make an element a container: a `container-type` other than
 * `normal`, or a `container` shorthand with `var()`, which leaves its longhands empty.
 */
function declaresContainer(style: CSSStyleDeclaration): boolean {
  const type = style.getPropertyValue("container-type");
  return type === "" ? style.getPropertyValue("container") !== "" : type !== "normal";
}

/**
 * Whether the text of a rule holds a declaration of `pattern` for which `matches` holds, each
 * declaration judged alone: a later one in the same block may set it back, which only reads the
 * rule as starting something. `probe` is a detached element's inline style, which parses the value.
 */
function textDeclares(
  text: string,
  pattern: RegExp,
  probe: CSSStyleDeclaration,
  matches: (style: CSSStyleDeclaration) => boolean,
): boolean {
  for (const [, name, value] of text.matchAll(pattern)) {
    probe.cssText = "";
    probe.setProperty(name as string, (value as string).replace(IMPORTANT, "").trim());
    // A value cut short may not parse again: it may hold anything.
    if (probe.length === 0 || matches(probe)) return true;
  }
  return false;
}

/** Adds the paint-only properties a declaration block sets to `inherit` to `facts`. */
function addInherited(names: Iterable<string>, facts: StyleFacts): void {
  for (const raw of names) {
    const name = raw.toLowerCase();
    if (name === "all") facts.inherited.add("all");
    else if (PAINT_ONLY.test(name) || CONTAINING.test(name)) facts.inherited.add(family(name));
  }
}

/** What the rules of a scope are read with. */
interface Reading {
  facts: StyleFacts;
  /** The sheets read already. */
  seen: Set<CSSStyleSheet>;
  /** See {@link textDeclares}. */
  probe: CSSStyleDeclaration;
}

/** Reads the text of a style rule, which holds the rules nested in it too. */
function readText(text: string, { facts, probe }: Reading): void {
  if (!facts.transitions && /transition/i.test(text)) {
    facts.transitions = textDeclares(text, TRANSITION_DECLARATION, probe, declaresTransition);
  }
  if (!facts.containers && /container/i.test(text)) {
    facts.containers = textDeclares(text, CONTAINER_DECLARATION, probe, declaresContainer);
  }
  if (/inherit/i.test(text)) {
    const names = Array.from(text.matchAll(INHERIT_DECLARATION), (match) => match[1] as string);
    addInherited(names, facts);
  }
}

/** Reads `rules`; `nested` when the text of a rule holding them was read. */
function readRules(rules: CSSRuleList, reading: Reading, nested = false): void {
  for (const rule of Array.from(rules)) {
    const type = kind(rule);
    switch (type) {
      case "CSSContainerRule":
        reading.facts.containers = true;
        break;
      case "CSSFontFaceRule":
        // Descriptors only, and reading them would serialise a source that may run to megabytes.
        continue;
      case "CSSKeyframesRule":
        for (const [, name] of rule.cssText.matchAll(KEYFRAME_DECLARATION)) {
          const prop = (name as string).startsWith("--") ? (name as string) : (name as string).toLowerCase();
          if (!NOT_ANIMATED.test(prop)) reading.facts.animated.add(prop);
        }
        continue;
      case "CSSImportRule": {
        const sheet = (rule as CSSImportRule).styleSheet;
        if (sheet) readSheet(sheet, reading);
        continue;
      }
    }
    const inner = (rule as Partial<CSSGroupingRule>).cssRules;
    if (nested || GROUPING_RULES.has(type)) {
      if (inner) readRules(inner, reading, nested);
      continue;
    }
    // The text of a style rule holds the rules nested in it too: those are only read for the rules
    // that count by their kind.
    const text = rule.cssText;
    readText(text, reading);
    if (inner && /@container|keyframes/i.test(text)) readRules(inner, reading, true);
  }
}

function readSheet(sheet: CSSStyleSheet, reading: Reading): void {
  if (reading.seen.has(sheet)) return;
  reading.seen.add(sheet);
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    reading.facts.unreadable = true;
    return;
  }
  readRules(rules, reading);
}

/**
 * Reads the style sheets and inline styles of `scope` (a document or a shadow root, the scope of its
 * `getAnimations()`) for {@link mayStartAnimations}. Sheets still loading and sheets or styles added
 * later are not seen.
 */
export function readStyleFacts(scope: Document | ShadowRoot): StyleFacts {
  const facts: StyleFacts = {
    transitions: false,
    containers: false,
    animated: new Set(),
    inherited: new Set(),
    unreadable: false,
  };
  const doc = scope.ownerDocument ?? (scope as Document);
  const reading: Reading = { facts, seen: new Set(), probe: doc.createElementNS(HTML_NS, "div").style };
  for (const sheet of [...Array.from(scope.styleSheets), ...(scope.adoptedStyleSheets ?? [])]) {
    readSheet(sheet as CSSStyleSheet, reading);
  }
  const inline = scope.querySelectorAll<HTMLElement>(
    '[style*="transition" i],[style*="container" i],[style*="inherit" i]',
  );
  for (const el of Array.from(inline)) {
    const style = el.style;
    if (style === undefined) continue;
    facts.transitions ||= declaresTransition(style);
    facts.containers ||= declaresContainer(style);
    addInherited(
      Array.from(style).filter((name) => style.getPropertyValue(name) === "inherit"),
      facts,
    );
  }
  return facts;
}

/**
 * Whether seeking or freezing animations can start a transition or a CSS animation in the scopes the
 * facts were read from ({@link readStyleFacts}), taken together, since values inherit across shadow
 * boundaries. A seek changes animated values only, so that turns on what keyframes animate:
 *  - `display`, `content-visibility` or a custom property: always (elements are rendered again, or
 *    a `var()` changes an animation name, a transition or a query),
 *  - paint-only properties (opacity, backgrounds, shadows, clips, masks, outlines, radii, z-index):
 *    only where an element with a transition takes one with `inherit`,
 *  - transforms, filters and motion paths: also where some element is a container, whose size a
 *    containing block or scrollbars that come and go can change,
 *  - anything else (inherited values, sizes, em and lh units): wherever a transition or a container
 *    can take the change.
 * So fades, slides, spinners and skeleton pulses start nothing, whatever transitions the page
 * declares. Unreadable cross-origin sheets count as starting something.
 */
export function mayStartAnimations(facts: Iterable<StyleFacts>): boolean {
  let transitions = false;
  let containers = false;
  const animated = new Set<string>();
  const inherited = new Set<string>();
  for (const one of facts) {
    if (one.unreadable) return true;
    transitions ||= one.transitions;
    containers ||= one.containers;
    for (const name of one.animated) animated.add(name);
    for (const name of one.inherited) inherited.add(name);
  }
  for (const name of animated) {
    if (RENDERING.test(name)) return true;
    const reached = transitions && (inherited.has("all") || inherited.has(family(name)));
    if (PAINT_ONLY.test(name)) {
      if (reached) return true;
    } else if (CONTAINING.test(name)) {
      if (reached || containers) return true;
    } else if (transitions || containers) {
      return true;
    }
  }
  return false;
}
