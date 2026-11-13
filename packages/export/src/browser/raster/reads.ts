/**
 * What the still check (`StillWatch`) and the far cache (`FarCache`) read of a document or shadow
 * root by value, for what changes a frame without a DOM mutation: its style sheets with the text of
 * their rules, and its Web Animations. Nothing of the page is wrapped or intercepted: however a
 * script edits a rule or an animation (whatever interface, whenever it took the object, from
 * whichever window), the next read gives another value.
 *
 * Each value is read once until the running script yields (the next microtask checkpoint): before a
 * walk, the still check of the last frame, the watch of the next one and the far cache read the same
 * sheets and animations one after the other, and nothing between those reads changes the page.
 */

/** The style sheets of a document or shadow root: those of its elements, then the adopted ones. */
export function sheetsOf(target: Document | ShadowRoot): CSSStyleSheet[] {
  return [...Array.from(target.styleSheets ?? []), ...(target.adoptedStyleSheets ?? [])] as CSSStyleSheet[];
}

/** What a read of a Web Animation gives (see {@link animationMark}). */
export interface AnimationMark {
  /** What it shows, to compare frames by: null while it runs on the wall clock. */
  state: readonly unknown[] | null;
  /** The CSS names of the properties its keyframes animate; null when they cannot be read. */
  names: readonly string[] | null;
}

interface Reads {
  texts: Map<CSSStyleSheet, string>;
  lists: Map<Document | ShadowRoot, readonly Animation[]>;
  marks: Map<Animation, AnimationMark>;
}

let reads: Reads | null = null;

function shared(): Reads {
  if (reads) return reads;
  const fresh: Reads = { texts: new Map(), lists: new Map(), marks: new Map() };
  reads = fresh;
  queueMicrotask(() => {
    if (reads === fresh) reads = null;
  });
  return fresh;
}

/**
 * An `@font-face` rule's text without its `src`, often a data URL of a whole font (a markdown page
 * holds about 380 KB of them for KaTeX, 2 ms a read): the export embeds each face as it first read
 * it (`FontFaceCache`), and the page takes a new source by loading it, which the watches observe.
 */
function faceText(rule: CSSFontFaceRule): string {
  const { style } = rule;
  let text = "@font-face{";
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (name !== "src") text += `${name}:${style.getPropertyValue(name)};`;
  }
  return `${text}}`;
}

/**
 * The text of a style sheet's rules, the rules of the sheets it imports included. The CSSOM
 * serialises the whole state of a rule (selectors, preludes, declarations, nested rules), so any
 * edit of a rule changes it, but for the source of a font face ({@link faceText}). Empty for a sheet
 * of another origin: no script can read or write its rules, so it changes only by loading, which
 * the watches observe.
 */
export function sheetText(sheet: CSSStyleSheet): string {
  const shares = shared();
  let text = shares.texts.get(sheet);
  if (text !== undefined) return text;
  text = "";
  let rules: CSSRuleList | null = null;
  try {
    rules = sheet.cssRules;
  } catch {
    rules = null;
  }
  for (let i = 0; rules && i < rules.length; i++) {
    const rule = rules[i] as CSSRule & { styleSheet?: CSSStyleSheet | null };
    // By interface name: each frame document has its own CSSFontFaceRule.
    text += rule.constructor.name === "CSSFontFaceRule" ? faceText(rule as CSSFontFaceRule) : rule.cssText;
    // An `@import` rule's own text only names its sheet.
    if (rule.styleSheet) text += `{${sheetText(rule.styleSheet)}}`;
  }
  shares.texts.set(sheet, text);
  return text;
}

/**
 * Which style sheets apply in `targets` (each sheet, whether it is switched off, its media) and,
 * with `texts`, the text of their rules ({@link sheetText}), in a list to compare with `same`.
 */
export function sheetState(targets: Iterable<Document | ShadowRoot>, texts: boolean): unknown[] {
  const state: unknown[] = [];
  for (const target of targets) {
    for (const sheet of sheetsOf(target)) {
      state.push(sheet, sheet.disabled, sheet.media?.mediaText);
      if (texts) state.push(sheetText(sheet));
    }
  }
  return state;
}

/** The Web Animations of a document or shadow root, in composite order. */
export function animationsOf(target: Document | ShadowRoot): readonly Animation[] {
  const shares = shared();
  let list = shares.lists.get(target);
  if (!list) {
    list = typeof target.getAnimations === "function" ? target.getAnimations() : [];
    shares.lists.set(target, list);
  }
  return list;
}

/** Keyframe members that name no property. */
const KEYFRAME_TIMING = new Set(["offset", "computedOffset", "easing", "composite"]);

/** A CSS property name from a keyframe member (`backgroundColor`, `webkitTextFillColor`, `--x`). */
function cssName(member: string): string {
  if (member.startsWith("--")) return member;
  if (member === "cssFloat") return "float";
  if (member === "cssOffset") return "offset";
  const name = member.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return name.startsWith("webkit-") ? `-${name}` : name;
}

/**
 * Reads an animation. What a keyframe effect shows follows from its target, its keyframes, how it
 * composites, and its iteration progress and iteration (`getComputedTiming()`), given the styles
 * under it, which the watches read themselves: compared by those rather than by time, a fill held
 * past its end or a `steps()` timing between two steps counts as unchanged, and keyframes set anew
 * count as a change. Another kind of effect is compared by its time.
 */
function readMark(animation: Animation): AnimationMark {
  const effect = animation.effect as KeyframeEffect | null;
  if (!effect) return { state: [], names: [] };
  let keyframes: ComputedKeyframe[] | null = null;
  try {
    keyframes = typeof effect.getKeyframes === "function" ? effect.getKeyframes() : null;
  } catch {
    keyframes = null;
  }
  let names: string[] | null = null;
  if (keyframes) {
    const found = new Set<string>();
    for (const frame of keyframes) for (const key of Object.keys(frame)) if (!KEYFRAME_TIMING.has(key)) found.add(key);
    names = Array.from(found, cssName);
  }
  if (animation.playState === "running") return { state: null, names };
  if (!keyframes) return { state: [animation.playState, animation.currentTime], names };
  const { progress, currentIteration } = effect.getComputedTiming();
  const state = [
    effect.target,
    effect.pseudoElement,
    effect.composite,
    effect.iterationComposite,
    progress,
    currentIteration,
    JSON.stringify(keyframes),
  ];
  return { state, names };
}

/** An animation as {@link readMark} reads it, once while the script runs. */
export function animationMark(animation: Animation): AnimationMark {
  const shares = shared();
  let mark = shares.marks.get(animation);
  if (!mark) {
    mark = readMark(animation);
    shares.marks.set(animation, mark);
  }
  return mark;
}

/** Whether two lists hold the same values (`Object.is`), in order. */
export function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}
