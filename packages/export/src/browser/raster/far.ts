import type { InheritedValues } from "./styles";

/** A box in CSS px of a document's viewport. */
interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * CSS properties whose animation changes how its target's own box looks and nothing else: not
 * where anything is laid out, nor how the boxes in it look (not inherited, and neither moving the
 * boxes in it nor holding those positioned in it, see {@link PAINT_DEEP}).
 */
const PAINT_SELF = new Set([
  "opacity",
  "background-color",
  "background-position",
  "background-position-x",
  "background-position-y",
  "background-size",
  "box-shadow",
  "clip-path",
  "mask-position",
  "mask-size",
  "outline-color",
  "outline-offset",
  "outline-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "text-decoration-color",
  "column-rule-color",
  "stop-color",
  "stop-opacity",
  "flood-color",
  "flood-opacity",
  "lighting-color",
  "z-index",
]);
/**
 * CSS properties whose animation changes how its target and what is inside it look, never where
 * anything else is laid out: inherited ones, and those that move the boxes in it or hold the ones
 * positioned in it. Animating anything not here nor in {@link PAINT_SELF} may move any box.
 */
const PAINT_DEEP = new Set([
  "transform",
  "translate",
  "rotate",
  "scale",
  "transform-origin",
  "perspective",
  "perspective-origin",
  "offset-path",
  "offset-distance",
  "offset-rotate",
  "offset-anchor",
  "offset-position",
  "filter",
  "backdrop-filter",
  "color",
  "text-shadow",
  "text-emphasis-color",
  "caret-color",
  "accent-color",
  "-webkit-text-fill-color",
  "-webkit-text-stroke-color",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-dashoffset",
  "stroke-dasharray",
  "stroke-width",
]);
/** Keyframe members that name no property. */
const KEYFRAME_TIMING = new Set(["offset", "computedOffset", "easing", "composite"]);
/**
 * Selector parts whose match on an element may change with a mutation that is neither in its
 * subtree nor on one of its ancestors: sibling combinators, structural and relational
 * pseudo-classes. A false match (`[class~=a]`, `::first-line`) only makes the check stricter.
 */
const NONLOCAL_SELECTOR = /[+~]|:(?:has|nth-|first-|last-|only-|empty|host-context)/;
/** A length in container query units (`5cqi`, `calc(2cqw + 1px)`): it follows a container's size. */
const CONTAINER_UNIT = /\dcq(?:[whib]|min|max)\b/;
/** Elements whose content sheets or document-wide colours depend on. */
const SHEET_OWNERS = new Set(["style", "link", "meta"]);
/**
 * Elements the UA's sheet styles by their place among their siblings (a details element's first
 * summary, a fieldset's first legend): a change of their children may restyle any of them.
 */
const STRUCTURED = new Set(["details", "fieldset"]);
/** Events that change a box without a mutation: loads, and popovers and details opening or closing. */
const EVENTS = ["load", "error", "toggle"] as const;

/** One document as far as the boxes cached in it go, its watched shadow roots included. */
interface Scope {
  doc: Document;
  observer: MutationObserver;
  /** The document and the shadow roots in it that are observed. */
  targets: Set<Document | ShadowRoot>;
  /** Mutation records and event targets since the last walk. */
  records: MutationRecord[];
  events: EventTarget[];
  fontsDone: boolean;
  /** What {@link sheetState}, {@link fontState}, focus and Web Animations read at the last walk. */
  sheets: unknown[];
  fonts: string;
  focus: unknown[];
  animations: Map<Animation, AnimationMark>;
  /**
   * Whether the sheets match by local selectors only ({@link NONLOCAL_SELECTOR}): a mutation then
   * restyles the subtree of its target only. Otherwise any mutation may restyle any box.
   */
  local: boolean;
  /** Whether the sheets query container sizes ({@link SheetReach.sized}). */
  sized: boolean;
  /** Bumped by a change that may move or restyle any box of the document. */
  epoch: number;
  /** Bumped by any change, layout or scroll that may move a box laid out against one far away. */
  stir: number;
  /** Bumped by any change that is not a scroll: floats outside a box may then move against it. */
  changes: number;
  listener: (event: Event) => void;
  onFonts: () => void;
}

/** A box written away from the viewport, with what tells that it would be written the same again. */
interface Entry<T> {
  scope: Scope;
  data: T;
  win: Window;
  reach: Area;
  parent: string;
  parentNs: string;
  context: number;
  floats: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** {@link FarKey.extent} from its box's edges (outwards negative at the left and top). */
  extent: Area;
  /** Its live computed style, and its used margins as written ({@link marginsOf}). */
  cs: CSSStyleDeclaration;
  margins: string;
  loose: boolean;
  open: boolean;
  scrolls: boolean;
  epoch: number;
  stir: number;
  changes: number;
  /** The last walk it was written in. */
  walk: number;
}

/** What {@link FarCache.record} keeps of a box, besides what is read from it. */
export interface FarKey {
  win: Window;
  reach: Area;
  parent: InheritedValues | null;
  parentNs: string;
  context: number;
  /** Floats the walk wrote before it in its document: only those may reach into a box (see `open`). */
  floats: number;
  /**
   * Where what it may draw lies, in the same px as its box: unless it is loose, all of it moves
   * with its box, so a box that only moved stays away while this does.
   */
  extent: Area;
  /**
   * Something in it is laid out against a box outside it (absolutely positioned, fixed or sticky
   * boxes): it may move without its own box moving, after any change in the document, scrolling
   * included.
   */
  loose: boolean;
  /**
   * Its content flows around floats outside it (a box that is no block formatting context): while
   * a float lies before it, now or when it was written, it may reflow after any change in the
   * document, though not when all of it scrolls. A box away from the viewport holds no float that
   * could reach out of it (the snapshot reads such a box in full), so the floats before it are all
   * written, and counted, before it.
   */
  open: boolean;
  /** It is a scroll container: written while its scroll offsets are 0, and marked for the still check. */
  scrolls: boolean;
}

const inheritedKeys = new WeakMap<InheritedValues, string>();

/** The inherited values a box is written against, as one string (read once per parent map). */
function inheritedKey(parent: InheritedValues | null): string {
  if (!parent) return "";
  let key = inheritedKeys.get(parent);
  if (key === undefined) {
    key = "";
    for (const [name, value] of parent) key += `${name}:${value};`;
    inheritedKeys.set(parent, key);
  }
  return key;
}

/**
 * The parent of a node in the flattened tree of its document: its slot, else its parent, a shadow
 * root's host. A document's own box (in a frame) depends only on the frame's size, which the
 * entries key on, so the walk up stops there.
 */
function up(node: Node): Node | null {
  const slot = (node as Partial<Slottable>).assignedSlot;
  if (slot) return slot;
  const parent = node.parentNode;
  if (parent) return parent.nodeType === 11 ? (parent as ShadowRoot).host : parent;
  return node.nodeType === 11 ? (node as ShadowRoot).host : null;
}

function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

function sameArea(a: Area, b: Area): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

/** Whether the extent `around` a box at `r` (see {@link Entry.extent}) lies wholly outside `area`. */
function away(r: DOMRectReadOnly, around: Area, area: Area): boolean {
  return (
    r.right + around.right < area.left ||
    r.left + around.left > area.right ||
    r.bottom + around.bottom < area.top ||
    r.top + around.top > area.bottom
  );
}

function ruleCount(sheet: CSSStyleSheet): number {
  try {
    return sheet.cssRules.length;
  } catch {
    return -1;
  }
}

/** The style sheets of a document or shadow root: those of its elements, then the adopted ones. */
export function sheetsOf(target: Document | ShadowRoot): CSSStyleSheet[] {
  return [...Array.from(target.styleSheets ?? []), ...(target.adoptedStyleSheets ?? [])] as CSSStyleSheet[];
}

/**
 * The style sheets that apply in a scope, with what tells that one changed (not rules edited in
 * place, see {@link FarCache.forget}).
 */
function sheetState(targets: Iterable<Document | ShadowRoot>): unknown[] {
  const state: unknown[] = [];
  for (const target of targets) {
    for (const sheet of sheetsOf(target)) state.push(sheet, sheet.disabled, sheet.media.mediaText, ruleCount(sheet));
  }
  return state;
}

/** What the rules of a sheet may match beyond the boxes a change reaches by itself. */
interface SheetReach {
  /** Its selectors match by an element and its ancestors only ({@link NONLOCAL_SELECTOR}). */
  local: boolean;
  /**
   * It queries container sizes, by container rules or container units ({@link CONTAINER_UNIT}): a
   * box laid out anew may restyle the boxes in another one.
   */
  sized: boolean;
}

/**
 * The {@link SheetReach} of each sheet read, with its rule count then. A rule edited in place may
 * keep the count (one replaced, a new selector, one inserted into a grouping rule): those are read
 * anew on {@link FarCache.forget}.
 */
let sheetReaches = new WeakMap<CSSStyleSheet, SheetReach & { count: number }>();

/** The {@link SheetReach} of a sheet: neither local nor free of container queries while unreadable. */
function sheetReach(sheet: CSSStyleSheet): SheetReach {
  const count = ruleCount(sheet);
  const known = sheetReaches.get(sheet);
  if (known?.count === count) return known;
  const reach = { count, local: count >= 0, sized: count < 0 };
  if (count >= 0) readRules(sheet.cssRules, reach);
  sheetReaches.set(sheet, reach);
  return reach;
}

function readRules(rules: CSSRuleList, reach: SheetReach): void {
  for (const rule of Array.from(rules)) {
    if (!reach.local && reach.sized) return;
    const r = rule as CSSRule & {
      selectorText?: unknown;
      cssRules?: CSSRuleList;
      styleSheet?: CSSStyleSheet | null;
      style?: CSSStyleDeclaration;
    };
    if (typeof r.selectorText === "string" && NONLOCAL_SELECTOR.test(r.selectorText)) reach.local = false;
    // Type tags, not instanceof: the rule may belong to another frame's realm.
    const kind = Object.prototype.toString.call(rule).slice(8, -1);
    // A container's size or a scope's limits may change without a mutation in what they style; so
    // may a length in container units, with or without a container rule.
    if (kind === "CSSContainerRule" || (r.style && CONTAINER_UNIT.test(r.style.cssText))) {
      reach.local = false;
      reach.sized = true;
    } else if (kind === "CSSScopeRule") reach.local = false;
    if (r.styleSheet) {
      const inner = sheetReach(r.styleSheet);
      reach.local &&= inner.local;
      reach.sized ||= inner.sized;
    }
    if (r.cssRules) readRules(r.cssRules, reach);
  }
}

/** The {@link SheetReach} of all the sheets of a scope. */
function scopeReach(targets: Iterable<Document | ShadowRoot>): SheetReach {
  const reach = { local: true, sized: false };
  for (const target of targets) {
    for (const sheet of sheetsOf(target)) {
      const one = sheetReach(sheet);
      reach.local &&= one.local;
      reach.sized ||= one.sized;
    }
  }
  return reach;
}

/**
 * The used margins of a box, which its far markup writes in px: in percentages, container units or
 * `auto`, they follow the size of a box outside it, which a change elsewhere may resize while its
 * own size stays.
 */
function marginsOf(cs: CSSStyleDeclaration): string {
  return ["top", "right", "bottom", "left"].map((side) => cs.getPropertyValue(`margin-${side}`)).join(" ");
}

/** The state of a document's fonts: any change, or a font still loading, may move any text. */
function fontState(doc: Document, faces: number): string {
  const fonts = doc.fonts;
  return `${fonts?.status} ${fonts?.size} ${faces}`;
}

/** A CSS property name from a keyframe member (`backgroundColor`, `webkitTextFillColor`, `--x`). */
function cssName(member: string): string {
  if (member.startsWith("--")) return member;
  if (member === "cssFloat") return "float";
  if (member === "cssOffset") return "offset";
  const name = member.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return name.startsWith("webkit-") ? `-${name}` : name;
}

/**
 * How far a change of an animation may reach: how its target's own box looks ({@link PAINT_SELF}),
 * how the boxes in it look too ({@link PAINT_DEEP}), or where any box is laid out.
 */
const SELF = 0;
const DEEP = 1;
const LAYOUT = 2;
type AnimationReach = typeof SELF | typeof DEEP | typeof LAYOUT;

/** What a walk read of a Web Animation: {@link animationState}, and how far a change of it reaches. */
interface AnimationMark {
  state: string | null;
  reach: AnimationReach;
}

/** The CSS names of the properties an animation animates; null when its keyframes cannot be read. */
function animatedNames(animation: Animation): string[] | null {
  const effect = animation.effect as KeyframeEffect | null;
  if (!effect || typeof effect.getKeyframes !== "function") return null;
  try {
    const names = new Set<string>();
    for (const frame of effect.getKeyframes()) {
      for (const key of Object.keys(frame)) if (!KEYFRAME_TIMING.has(key)) names.add(cssName(key));
    }
    return [...names];
  } catch {
    return null;
  }
}

function reachOf(names: readonly string[] | null): AnimationReach {
  if (!names) return LAYOUT;
  let reach: AnimationReach = SELF;
  for (const name of names) {
    if (PAINT_DEEP.has(name)) reach = DEEP;
    else if (!PAINT_SELF.has(name)) return LAYOUT;
  }
  return reach;
}

/**
 * An animation's state for comparing frames, null while it runs on the wall clock: the computed
 * values of what it animates on its target (`names`, read from its keyframes by default), which
 * the walk writes, so a frame that changes none of them (a `steps()` timing between steps, a fill
 * held past its end) changes nothing; its timing where one of them reads empty.
 */
export function animationState(
  animation: Animation,
  names: readonly string[] | null = animatedNames(animation),
): string | null {
  if (animation.playState === "running") return null;
  const timing = `@${animation.playState} ${String(animation.currentTime)} ${animation.playbackRate}`;
  const effect = animation.effect as KeyframeEffect | null;
  const target = effect?.target;
  const win = target?.ownerDocument.defaultView;
  if (!names || !effect || !target || !win) return timing;
  const cs = win.getComputedStyle(target, effect.pseudoElement);
  let state = "";
  for (const name of names) {
    const value = cs.getPropertyValue(name);
    if (value === "") return timing;
    state += `${value};`;
  }
  return state;
}

function markOf(animation: Animation): AnimationMark {
  const names = animatedNames(animation);
  return { state: animationState(animation, names), reach: reachOf(names) };
}

/** Whether a mutation adds, removes or edits a style sheet or a colour-scheme meta element. */
function touchesSheets(record: MutationRecord): boolean {
  const owner = (node: Node | null) => node?.nodeType === 1 && SHEET_OWNERS.has((node as Element).localName);
  if (owner(record.target) || (record.type === "characterData" && owner(record.target.parentNode))) return true;
  if (record.type !== "childList") return false;
  for (const list of [record.addedNodes, record.removedNodes]) {
    for (const node of Array.from(list)) {
      if (owner(node) || (node.nodeType === 1 && (node as Element).querySelector("style,link,meta"))) return true;
    }
  }
  return false;
}

/** What the walk needs of a document: its view, and where it reads shadow roots and FontFace faces. */
export interface FarSource {
  document: Document;
  shadowRoots(): Iterable<ShadowRoot>;
  faces(): readonly unknown[];
}

/**
 * Remembers the boxes a snapshot walk wrote away from the viewport (left out, or written as empty
 * boxes), with the markup it wrote for each, and tells the next walk which of them it may write
 * the same way again without reading their subtrees: a long page held still under one CSS
 * animation, after going live, otherwise reads every far box again on every frame.
 *
 * A box written again must still be away from the viewport, written against the same inherited
 * values, keys and box, with nothing in its subtree changed. Before each walk, {@link begin} reads
 * what changed since the last one in each document a box was cached in (its watched shadow roots
 * included), and drops what that may have reached:
 * - a mutation drops the boxes it is inside of, and those inside its target (attributes) or the
 *   nodes it added; any box at all where the sheets match by more than an element and its
 *   ancestors ({@link NONLOCAL_SELECTOR}, container and scope rules, container units, a sheet
 *   that cannot be read), or when it adds or edits a style sheet;
 * - a load or error (images, frames), and a popover or details element opening or closing, as a
 *   mutation of its target; of a style sheet, as any change of the sheets;
 * - a Web Animation that runs, or changed a value it animates since: the boxes around its target
 *   when it only animates how its target's own box paints ({@link PAINT_SELF}), and those inside
 *   it too when it animates how they paint ({@link PAINT_DEEP}); otherwise, as a mutation of its
 *   target's style, those inside and around it, and any box where the sheets query container
 *   sizes (container rules or units, see {@link SheetReach.sized}) or cannot be read;
 * - a change of the sheets, the font sets, a font loading, or a change of focus: any box.
 * The walk then checks each box itself: the same size and used margins (in percentages, container
 * units or `auto`, those follow a box outside it that such a change may have resized), and the
 * same place or, when what is in it all moves with it, an extent still away from the viewport; for
 * a box with something laid out against a box outside it, the same place and no change at all in
 * its document, scroll offsets included; for a box whose content flows around floats outside it
 * with a float before it, no change in its document but scrolling. Form control state, custom
 * element definitions and custom states are not seen, as by the still check (`StillWatch`), nor
 * are rules edited in place through the CSSOM: the rasterizer reads those from the still check,
 * then drops every box and reads what the sheets match anew ({@link forget}).
 */
export class FarCache<T> {
  readonly #scopes = new Map<Document, Scope>();
  #entries = new Map<Element, Entry<T>>();
  readonly #pending = new Map<Element, Entry<T>>();
  /** Scroll offsets the last walk read (see `FrameSnapshot.settled`). */
  #scrolls: readonly { el: Element; left: number; top: number }[] = [];
  #walk = 0;

  /** Reads what changed since the last walk; call at the start of every walk. */
  begin(source: FarSource): void {
    this.#walk++;
    this.#pending.clear();
    const top = this.#scope(source.document);
    for (const root of source.shadowRoots()) this.watchRoot(root);
    const reached = new Set<Node>();
    for (const scope of Array.from(this.#scopes.values())) {
      if (scope.doc.defaultView === null) {
        this.#drop(scope);
        continue;
      }
      this.#read(scope, scope === top ? source.faces().length : 0, reached);
    }
    for (const { el, left, top: y } of this.#scrolls) {
      if (el.scrollLeft !== left || el.scrollTop !== y) {
        const scope = this.#scopes.get(el.ownerDocument);
        if (scope) scope.stir++;
      }
    }
    if (reached.size === 0) return;
    for (const el of Array.from(this.#entries.keys())) {
      for (let node: Node | null = el; node; node = up(node)) {
        if (reached.has(node)) {
          this.#entries.delete(el);
          break;
        }
      }
    }
  }

  /** Observes a shadow root the walk reads (no change before this call reaches what it read). */
  watchRoot(root: ShadowRoot): void {
    const scope = this.#scope(root.ownerDocument);
    if (!scope || scope.targets.has(root)) return;
    this.#observe(scope, root);
  }

  /**
   * The data of a box written in the last walk away from the viewport, when it would be written
   * the same way now, else null.
   */
  reuse(el: Element, key: Omit<FarKey, "extent" | "loose" | "open" | "scrolls">): T | null {
    const entry = this.#entries.get(el);
    if (!entry) return null;
    const { scope } = entry;
    if (entry.epoch !== scope.epoch || (entry.loose && entry.stir !== scope.stir)) return null;
    if (entry.open && entry.changes !== scope.changes && (entry.floats > 0 || key.floats > 0)) return null;
    // A mutation since the walk started: it is read before the next one.
    if (scope.records.length > 0 || scope.events.length > 0) return null;
    if (entry.win !== key.win || entry.parentNs !== key.parentNs || entry.context !== key.context) return null;
    if (!sameArea(entry.reach, key.reach) || entry.parent !== inheritedKey(key.parent)) return null;
    const r = el.getBoundingClientRect();
    if (r.width !== entry.width || r.height !== entry.height) return null;
    // Written in px, its margins may follow a box a change outside it resized (see marginsOf).
    if (marginsOf(entry.cs) !== entry.margins) return null;
    // Moved: still away while all it may draw is, which moved with it.
    const moved = r.left !== entry.left || r.top !== entry.top;
    if (moved && (entry.loose || !away(r, entry.extent, key.reach))) return null;
    if (entry.scrolls && (el.scrollLeft !== 0 || el.scrollTop !== 0)) return null;
    entry.walk = this.#walk;
    return entry.data;
  }

  /** Keeps a box written away from the viewport, once the walk completes ({@link commit}). */
  record(el: Element, key: FarKey, data: T): void {
    const scope = this.#scope(el.ownerDocument);
    if (!scope) return;
    const r = el.getBoundingClientRect();
    const { extent } = key;
    const cs = key.win.getComputedStyle(el);
    this.#pending.set(el, {
      scope,
      data,
      win: key.win,
      reach: { ...key.reach },
      parent: inheritedKey(key.parent),
      parentNs: key.parentNs,
      context: key.context,
      floats: key.floats,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      extent: {
        left: extent.left - r.left,
        top: extent.top - r.top,
        right: extent.right - r.right,
        bottom: extent.bottom - r.bottom,
      },
      cs,
      margins: marginsOf(cs),
      loose: key.loose,
      open: key.open,
      scrolls: key.scrolls,
      epoch: scope.epoch,
      stir: scope.stir,
      changes: scope.changes,
      walk: this.#walk,
    });
  }

  /**
   * Keeps the boxes the completed walk recorded, and drops those it did not write again (gone, or
   * no longer reached). `scrolls` are the scroll offsets it read.
   */
  commit(scrolls: readonly { el: Element; left: number; top: number }[]): void {
    for (const [el, entry] of this.#pending) this.#entries.set(el, entry);
    this.#pending.clear();
    const kept = new Map<Element, Entry<T>>();
    for (const [el, entry] of this.#entries) if (entry.walk === this.#walk) kept.set(el, entry);
    this.#entries = kept;
    this.#scrolls = scrolls;
  }

  /**
   * Drops every box kept, for a change it does not read itself (rules edited in place), and reads
   * anew what the sheets match: an edit that keeps the rule count may match beyond the boxes a
   * mutation reaches by itself, or query container sizes, from now on.
   */
  forget(): void {
    this.#entries.clear();
    sheetReaches = new WeakMap();
    for (const scope of this.#scopes.values()) Object.assign(scope, scopeReach(scope.targets));
  }

  /** The boxes kept for the next walk (for tests and diagnostics). */
  get size(): number {
    return this.#entries.size;
  }

  #scope(doc: Document): Scope | null {
    const known = this.#scopes.get(doc);
    if (known) return known;
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    if (!win) return null;
    const scope: Scope = {
      doc,
      observer: new win.MutationObserver((records) => {
        scope.records.push(...records);
      }),
      targets: new Set(),
      records: [],
      events: [],
      fontsDone: false,
      sheets: [],
      fonts: fontState(doc, 0),
      focus: [],
      animations: new Map(),
      local: false,
      sized: true,
      epoch: 0,
      stir: 0,
      changes: 0,
      listener: (event) => {
        if (event.target) scope.events.push(event.target);
      },
      onFonts: () => {
        scope.fontsDone = true;
      },
    };
    doc.fonts?.addEventListener("loadingdone", scope.onFonts);
    this.#scopes.set(doc, scope);
    this.#observe(scope, doc);
    return scope;
  }

  #observe(scope: Scope, target: Document | ShadowRoot): void {
    scope.targets.add(target);
    scope.observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
    for (const type of EVENTS) target.addEventListener(type, scope.listener, true);
    // What is read without events starts here; the boxes cached so far in the scope go once.
    scope.sheets = sheetState(scope.targets);
    Object.assign(scope, scopeReach(scope.targets));
    scope.focus = Array.from(scope.targets, (t) => t.activeElement);
    for (const animation of target.getAnimations?.() ?? []) scope.animations.set(animation, markOf(animation));
    scope.epoch++;
  }

  #drop(scope: Scope): void {
    scope.observer.disconnect();
    for (const target of scope.targets) {
      for (const type of EVENTS) target.removeEventListener(type, scope.listener, true);
    }
    scope.doc.fonts?.removeEventListener("loadingdone", scope.onFonts);
    this.#scopes.delete(scope.doc);
  }

  /**
   * Reads what changed in a scope since the last walk: bumps its epoch for a change that may reach
   * any box, drops the boxes around each node changed in a narrower way, and adds those nodes to
   * `reached` when what is inside them may have changed too.
   */
  #read(scope: Scope, faces: number, reached: Set<Node>): void {
    const records = scope.records.splice(0);
    records.push(...scope.observer.takeRecords());
    const events = scope.events.splice(0);
    let all = scope.fontsDone || scope.doc.fonts?.status === "loading";
    scope.fontsDone = false;
    const fonts = fontState(scope.doc, faces);
    if (fonts !== scope.fonts) all = true;
    scope.fonts = fonts;
    const sheets = sheetState(scope.targets);
    if (!same(sheets, scope.sheets)) {
      all = true;
      scope.sheets = sheets;
      Object.assign(scope, scopeReach(scope.targets));
    }
    const focus = Array.from(scope.targets, (t) => t.activeElement);
    if (!same(focus, scope.focus)) all = true;
    scope.focus = focus;
    for (const record of records) {
      if (all || !scope.local || touchesSheets(record)) {
        all = true;
        break;
      }
      const target = record.target;
      if (record.type === "characterData") {
        if (target.parentNode) this.#reach(target.parentNode, false, reached);
      } else if (record.type === "attributes") {
        this.#reach(target, true, reached);
      } else {
        this.#reach(target, target.nodeType === 1 && STRUCTURED.has((target as Element).localName), reached);
        for (const node of Array.from(record.addedNodes)) if (node.nodeType === 1) this.#reach(node, true, reached);
      }
    }
    for (const target of events) {
      const node = target as Node;
      if (all || typeof node.nodeType !== "number") continue;
      if (node.nodeType === 1 && SHEET_OWNERS.has((node as Element).localName)) all = true;
      else this.#reach(node, true, reached);
    }
    const animations = new Map<Animation, AnimationMark>();
    for (const target of scope.targets) {
      for (const animation of target.getAnimations?.() ?? []) animations.set(animation, markOf(animation));
    }
    let layout = false;
    const moved = (animation: Animation, reach: AnimationReach) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (!target) return;
      if (reach !== LAYOUT) this.#reach(target, reach === DEEP, reached);
      // As a change of its target's style: it restyles its subtree and may move any box, which
      // the walk checks, or restyle any box where the sheets query container sizes.
      else if (scope.sized) all = true;
      else {
        layout = true;
        this.#reach(target, true, reached);
      }
    };
    for (const [animation, mark] of animations) {
      const last = scope.animations.get(animation);
      if (mark.state !== null && last?.state === mark.state) continue;
      // The wider reach of what it animated and what it animates (keyframes set anew).
      moved(animation, Math.max(mark.reach, last?.reach ?? SELF) as AnimationReach);
    }
    for (const [animation, last] of scope.animations) if (!animations.has(animation)) moved(animation, last.reach);
    scope.animations = animations;
    if (all) scope.epoch++;
    if (all || layout || records.length > 0 || events.length > 0) {
      scope.stir++;
      scope.changes++;
    }
  }

  /**
   * Drops the boxes `node` is in or is (its change is in their subtree), and adds it to `reached`
   * when `subtree`: what is inside it may have changed too.
   */
  #reach(node: Node, subtree: boolean, reached: Set<Node>): void {
    if (subtree) reached.add(node);
    for (let at: Node | null = node; at; at = up(at)) if (at.nodeType === 1) this.#entries.delete(at as Element);
  }
}
