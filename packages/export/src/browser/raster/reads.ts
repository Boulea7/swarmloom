/**
 * What the still check (`StillWatch`) and the far cache (`FarCache`) read of a document or shadow
 * root by value, for what changes a frame without a DOM mutation: its style sheets with the text of
 * their rules, its focus and its Web Animations. Nothing of the page is wrapped or intercepted:
 * however a script edits a rule or an animation (whatever interface, whenever it took the object,
 * from whichever window), the next read gives another value.
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
  /**
   * The CSS names of the properties its keyframes animate, null when they cannot be read: read when
   * first asked for (the far cache asks only once the animation shows something else).
   */
  names(): readonly string[] | null;
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

/** The last text {@link sheetText} read of a sheet, and what {@link sheetTakesUpdates} found in it. */
interface SheetRead {
  text: string;
  /** Some of its rules, or of the sheets it imports, cannot be read: they are of another origin. */
  opaque: boolean;
  updates?: boolean;
}

const lastReads = new WeakMap<CSSStyleSheet, SheetRead>();

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
  let opaque = false;
  try {
    rules = sheet.cssRules;
  } catch {
    rules = null;
    opaque = true;
  }
  for (let i = 0; rules && i < rules.length; i++) {
    const rule = rules[i] as CSSRule & { styleSheet?: CSSStyleSheet | null };
    // By interface name: each frame document has its own CSSFontFaceRule.
    text += rule.constructor.name === "CSSFontFaceRule" ? faceText(rule as CSSFontFaceRule) : rule.cssText;
    // An `@import` rule's own text only names its sheet.
    if (!rule.styleSheet) continue;
    text += `{${sheetText(rule.styleSheet)}}`;
    opaque ||= lastReads.get(rule.styleSheet)?.opaque === true;
  }
  shares.texts.set(sheet, text);
  const last = lastReads.get(sheet);
  if (last?.text !== text || last.opaque !== opaque) lastReads.set(sheet, { text, opaque });
  return text;
}

/**
 * CSS whose effect the engine takes at a rendering update, from the layout and scroll offsets it
 * sees then, and keeps until the next one, wherever it is written: scroll-state container queries,
 * and anchor positioning (the scroll offsets an anchored box follows, the `@position-try` fallback
 * it took).
 */
const UPDATE_NAMES = /scroll-state\(|anchor(?:-size)?\(|anchor-center|@position-try/i;

/**
 * Declarations of the rest of that CSS: anchor positioning by area and fallbacks, whether a
 * `content-visibility: auto` box is relevant (and so the size it lays out at), and scroll and view
 * timelines. Each counts unless its value turns it off ({@link QUIET}), as a reset with
 * `all: initial` does, which Chromium writes out as every longhand.
 */
const UPDATE_DECLARATIONS =
  /(content-visibility|animation-timeline|position-area|inset-area|position-try(?:-fallbacks)?)\s*:\s*([^;}]*)/gi;

/** Values that take nothing at a rendering update by themselves (CSS-wide keywords inherit or reset). */
const QUIET = /^(?:none|normal(?:\s+none)?|initial|inherit|unset|revert|revert-layer)$/i;

/** Whether a declaration of {@link UPDATE_DECLARATIONS} turns its feature on. */
function turnsOn(property: string, value: string): boolean {
  if (property === "content-visibility") return /auto|var\(/i.test(value);
  // `auto` is the document's timeline.
  if (property === "animation-timeline") return /scroll\(|view\(|--/i.test(value);
  return !QUIET.test(value);
}

/**
 * Whether CSS text (rules or a `style` attribute) may use what the engine takes at a rendering
 * update. A match elsewhere, as in a string, only makes a page wait for nothing.
 */
function cssTakesUpdates(text: string): boolean {
  if (UPDATE_NAMES.test(text)) return true;
  for (const [, name = "", value = ""] of text.matchAll(UPDATE_DECLARATIONS)) {
    if (turnsOn(name.toLowerCase(), value.replace(/!\s*important\s*$/i, "").trim())) return true;
  }
  return false;
}

/**
 * Whether the rules of a style sheet may use what the engine takes at a rendering update
 * ({@link cssTakesUpdates}); true when some of them cannot be read (another origin's). Reads the
 * text of a sheet not read before (an element given new CSS gets a new sheet object); after that it
 * follows the text {@link sheetText} last read for the watches, so an edit through the CSSOM counts
 * from the next frame that reads the text (no page script runs in an export).
 */
export function sheetTakesUpdates(sheet: CSSStyleSheet): boolean {
  let read = lastReads.get(sheet);
  if (!read) {
    sheetText(sheet);
    read = lastReads.get(sheet) as SheetRead;
  }
  read.updates ??= read.opaque || cssTakesUpdates(read.text);
  return read.updates;
}

/**
 * Whether the CSS of documents and shadow roots may use what the engine takes at a rendering update
 * ({@link cssTakesUpdates}): in a rule of their style sheets ({@link sheetTakesUpdates}) or in a
 * `style` attribute of their elements (read after all the sheets, which are mostly known).
 */
export function takesUpdates(targets: readonly (Document | ShadowRoot)[]): boolean {
  if (targets.some((target) => sheetsOf(target).some(sheetTakesUpdates))) return true;
  return targets.some((target) =>
    Array.from(target.querySelectorAll("[style]")).some((el) => cssTakesUpdates(el.getAttribute("style") ?? "")),
  );
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

/** An effect's keyframes, or null when they cannot be read (another kind of effect). */
function keyframesOf(effect: KeyframeEffect): ComputedKeyframe[] | null {
  try {
    return typeof effect.getKeyframes === "function" ? effect.getKeyframes() : null;
  } catch {
    return null;
  }
}

/** The CSS names of the properties `keyframes` animate (see {@link AnimationMark.names}). */
function namesOf(keyframes: readonly ComputedKeyframe[] | null): string[] | null {
  if (!keyframes) return null;
  const found = new Set<string>();
  for (const frame of keyframes) for (const key of Object.keys(frame)) if (!KEYFRAME_TIMING.has(key)) found.add(key);
  return Array.from(found, cssName);
}

/** Animations whose keyframes the style sheets give, by interface name: each frame has its own. */
const STYLED = new Set(["CSSAnimation", "CSSTransition"]);

/**
 * Reads an animation. What a keyframe effect shows follows from the effect, its target, its
 * keyframes, how it composites, and its iteration progress and iteration (`getComputedTiming()`),
 * given the styles under it, which the watches read themselves: compared by those rather than by
 * time, a fill held past its end or a `steps()` timing between two steps counts as unchanged. The
 * keyframes are compared where they come from: a script's animation by its keyframes, so keyframes
 * set anew count as a change; a CSS animation (its `@keyframes` rule) or a CSS transition (the two
 * values it runs between, fixed as it starts) through the text of the style sheets, which the
 * watches compare, and the style that names it, a new name or transition being a new animation. A
 * script that sets the keyframes of a CSS animation or transition goes unseen. Reading keyframes
 * is the dearest part (about 15 us each for a CSS animation in Chromium), and a page that fades in
 * every card holds hundreds. Another kind of effect is compared by its time.
 */
function readMark(animation: Animation): AnimationMark {
  const effect = animation.effect as KeyframeEffect | null;
  if (!effect) return { state: [], names: () => [] };
  const styled = STYLED.has(Object.prototype.toString.call(animation).slice(8, -1));
  const keyframes = styled ? null : keyframesOf(effect);
  let names: readonly string[] | null | undefined = styled ? undefined : namesOf(keyframes);
  const named = (): readonly string[] | null => {
    if (names === undefined) names = namesOf(keyframesOf(effect));
    return names;
  };
  if (animation.playState === "running") return { state: null, names: named };
  if (!styled && !keyframes) return { state: [animation.playState, animation.currentTime], names: named };
  const { progress, currentIteration } = effect.getComputedTiming();
  const state = [
    effect,
    effect.target,
    effect.pseudoElement,
    effect.composite,
    effect.iterationComposite,
    progress,
    currentIteration,
  ];
  if (keyframes) state.push(JSON.stringify(keyframes));
  return { state, names: named };
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

/**
 * Focus in a document or shadow root as the styles see it: the focused element, whether it matches
 * `:focus-visible` (a script focusing it again may change that alone), and for a document whether
 * it has the system focus, without which `:focus` matches nothing in it.
 */
export function focusState(target: Document | ShadowRoot): unknown[] {
  const el = target.activeElement;
  const doc = target.nodeType === 9 ? (target as Document) : null;
  return [el, el?.matches(":focus-visible") ?? false, doc?.hasFocus() ?? null];
}

/** Whether two lists hold the same values (`Object.is`), in order. */
export function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}
