import { now } from "../util/slice";
import { pseudoStyleOf } from "./pseudo-style";
import { type Capture, type ElInfo, infoOf } from "./state";

/**
 * CSS counters for ::before / ::after content. The computed `content` only says `counter(step)`, so
 * the values are replayed with one tree-order pass over the counter properties (reset, then increment,
 * then set; a sibling's reset replaces the counter, a descendant's nests it), including the implicit
 * `list-item` counter of HTML lists and reversed counters, which count down. The pass is resumable:
 * the walk advances it under its slice deadline (countersReady), so a page full of counters is never
 * counted in one long task. Only a reversed counter without a start value is read ahead to the end
 * of its scope, which its start depends on.
 */

/** Counter values in scope at one pseudo-element: name -> nested values, outermost first. */
export type CounterValues = ReadonlyMap<string, readonly number[]>;

/** Formats `counter(name, style)` (separator null) or `counters(name, separator, style)`. */
export type CounterReader = (name: string, separator: string | null, style: string) => string;

interface Instance {
  value: number;
  /** The scope ends after this node's subtree (the parent of the element that created it). */
  owner: Node;
  /** A reversed counter: list items step it down (reversed(), <ol reversed>). */
  reversed: boolean;
  /** A reversed counter created without a value: its start is summed until its scope is counted. */
  tally?: Tally;
}

/**
 * The start of a reversed counter created without a value (CSS Lists 4.4): the negated steps of its
 * scope up to the first counter-set (plus that value), plus the last non-zero negated step. Values
 * read before the start is known are relative to 0 and fixed when it is (`refs`).
 */
interface Tally {
  num: number;
  last: number;
  refs: [number[], number][];
}

type Pairs<F = number> = [string, number | F][];

/** One counter-reset entry; a null value is a reversed counter that counts its own start. */
interface Reset {
  name: string;
  value: number | null;
  reversed: boolean;
}

/** An open element of the pass (null info: the root) with its children and the next one to enter. */
interface Frame {
  info: ElInfo | null;
  kids: Element[];
  next: number;
}

/** Pass progress at an element: its ::before is counted, then its subtree and ::after. */
const BEFORE = 1;
const AFTER = 2;

/** Resumable counter pass over one document or shadow root; it only goes as far as it is asked to. */
export interface CounterIndex {
  readonly root: Document | ShadowRoot;
  /** Values in scope at each pseudo-element whose content uses a counter. */
  readonly values: Map<Element, { before?: CounterValues; after?: CounterValues }>;
  readonly progress: Map<Element, number>;
  readonly stacks: Map<string, Instance[]>;
  /** Reversed counters whose start is not known yet. */
  open: number;
  /** Open elements, root first: empty before the pass starts and once it is finished. */
  readonly path: Frame[];
  started: boolean;
}

const LISTS: ReadonlySet<string> = new Set(["ol", "ul", "menu"]);

/** Content that puts a counter into a pseudo-element. */
const USES_COUNTER = /counters?\(/;

/** Parses a computed `counter-*` value such as `step 1 item 0` (missing numbers default to `fallback`). */
function pairs<F>(value: string, fallback: F): Pairs<F> {
  const out: Pairs<F> = [];
  if (!value || value === "none") return out;
  for (const token of value.trim().split(/\s+/)) {
    const n = Number(token);
    const last = out.at(-1);
    if (/^[+-]?\d+$/.test(token) && last) last[1] = n;
    else out.push([token, fallback]);
  }
  return out;
}

/** Parses a computed counter-reset such as `step reversed(list-item) 4`. */
function resets(value: string): Reset[] {
  return pairs(value, null).map(([token, v]) => {
    const name = /^reversed\((.*)\)$/.exec(token)?.[1];
    return name === undefined ? { name: token, value: v ?? 0, reversed: false } : { name, value: v, reversed: true };
  });
}

/**
 * The list-item reset of an HTML list whose computed counter-reset leaves it out, as Chromium draws
 * counter(list-item): start - 1, or start + 1 counting down for <ol reversed>. Chromium (150, 156)
 * starts a reversed list without a start attribute at 0 there rather than at its item count, and
 * ignores <li value>, though its markers honour both. Engines that map these attributes to
 * counter-reset and counter-set (Firefox) show them in the computed style instead.
 */
function listReset(el: Element): Reset {
  const ol = el.localName === "ol";
  const start = Number.parseInt(el.getAttribute("start") ?? "", 10);
  const reversed = ol && el.hasAttribute("reversed");
  const first = ol && Number.isFinite(start) ? start : reversed ? 0 : 1;
  return { name: "list-item", value: reversed ? first + 1 : first - 1, reversed };
}

function stackOf(index: CounterIndex, name: string): Instance[] {
  let stack = index.stacks.get(name);
  if (!stack) {
    stack = [];
    index.stacks.set(name, stack);
  }
  return stack;
}

/** The innermost counter `name` in scope; a missing counter is created at 0. */
function current(index: CounterIndex, name: string, owner: Node): Instance {
  const stack = stackOf(index, name);
  const top = stack.at(-1);
  if (top) return top;
  const created = { value: 0, owner, reversed: false };
  stack.push(created);
  return created;
}

/** Fixes the start of a reversed counter whose tally is complete, in its value and the values read so far. */
function settle(index: CounterIndex, c: Instance): void {
  const t = c.tally;
  if (!t) return;
  const start = t.num + t.last;
  c.value += start;
  for (const [values, i] of t.refs) values[i] = (values[i] ?? 0) + start;
  c.tally = undefined;
  index.open--;
}

function apply(index: CounterIndex, cs: CSSStyleDeclaration, owner: Node, el: Element | null, listItem: boolean): void {
  const reset = resets(cs.counterReset);
  const inc = pairs(cs.counterIncrement, 1);
  const set = pairs(cs.counterSet, 0);
  if (el && LISTS.has(el.localName) && !reset.some((r) => r.name === "list-item")) reset.push(listReset(el));
  for (const { name, value, reversed } of reset) {
    const stack = stackOf(index, name);
    // A sibling's reset ends the earlier counter's scope.
    if (stack.at(-1)?.owner === owner) settle(index, stack.pop() as Instance);
    if (value === null) index.open++;
    const tally = value === null ? { num: 0, last: 0, refs: [] } : undefined;
    stack.push({ value: value ?? 0, owner, reversed, tally });
  }
  if (listItem && !inc.some(([n]) => n === "list-item")) {
    inc.push(["list-item", current(index, "list-item", owner).reversed ? -1 : 1]);
  }
  for (const [name, v] of inc) {
    const c = current(index, name, owner);
    c.value += v;
    if (c.tally) {
      c.tally.num -= v;
      if (v !== 0) c.tally.last = -v;
    }
  }
  for (const [name, v] of set) {
    const c = current(index, name, owner);
    if (c.tally) {
      // The first counter-set ends the tally; this element's own step is left out of the sum.
      c.tally.num += (inc.find(([n]) => n === name)?.[1] ?? 0) + v;
      settle(index, c);
    }
    c.value = v;
  }
}

/** Counts one pseudo-element and records the values in scope when its content uses them. */
function countPseudo(index: CounterIndex, info: ElInfo, which: "before" | "after"): void {
  const cs = pseudoStyleOf(info, which);
  if (!cs) return;
  apply(index, cs, info.el, null, false);
  if (!cs.content.includes("counter")) return;
  const values = new Map<string, number[]>();
  for (const [name, stack] of index.stacks) {
    const nested = stack.map((i) => i.value);
    for (const [i, c] of stack.entries()) c.tally?.refs.push([nested, i]);
    if (nested.length > 0) values.set(name, nested);
  }
  const entry = index.values.get(info.el) ?? {};
  entry[which] = values;
  index.values.set(info.el, entry);
}

/** Moves the pass one step in tree order: into the next element or out of the open one. False once finished. */
function step(cap: Capture, index: CounterIndex): boolean {
  const top = index.path.at(-1);
  if (!top) return false;
  const el = top.kids[top.next++];
  if (el) {
    const info = infoOf(cap, el);
    if (info.display === "none") return true;
    apply(index, info.cs, top.info?.el ?? index.root, el, info.display.includes("list-item"));
    countPseudo(index, info, "before");
    index.progress.set(el, BEFORE);
    index.path.push({ info, kids: Array.from(el.children), next: 0 });
    return true;
  }
  index.path.pop();
  if (top.info) {
    const done = top.info.el;
    countPseudo(index, top.info, "after");
    index.progress.set(done, AFTER);
    for (const stack of index.stacks.values()) {
      while (stack.at(-1)?.owner === done) settle(index, stack.pop() as Instance);
    }
  } else {
    for (const stack of index.stacks.values()) for (const c of stack) settle(index, c);
  }
  return true;
}

function start(index: CounterIndex): void {
  index.started = true;
  index.path.push({ info: null, kids: Array.from(index.root.children), next: 0 });
}

/** True when a readable rule puts a counter into generated content (nested and imported rules included). */
function rulesUseCounters(rules: CSSRuleList, depth: number): boolean {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule & {
      style?: CSSStyleDeclaration;
      cssRules?: CSSRuleList;
      styleSheet?: CSSStyleSheet;
    };
    if (USES_COUNTER.test(rule.style?.getPropertyValue("content") ?? "")) return true;
    if (depth >= 8) continue;
    const nested = rule.styleSheet ? sheetRules(rule.styleSheet) : rule.cssRules;
    if (nested && rulesUseCounters(nested, depth + 1)) return true;
  }
  return false;
}

function sheetRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    // Cross-origin sheets cannot be read: a counter of theirs starts the pass at its first use.
    return null;
  }
}

/**
 * Per capture, whether each style sheet looked at puts a counter into generated content. A sheet
 * that many shadow roots adopt is scanned once per snapshot; a later snapshot looks again, since
 * sheets can change in between.
 */
const sheetVerdicts = new WeakMap<Capture, WeakMap<CSSStyleSheet, boolean>>();

/** True when a readable style sheet of the root puts a counter into generated content. */
function sheetsUseCounters(cap: Capture, root: Document | ShadowRoot): boolean {
  const verdicts = sheetVerdicts.get(cap) ?? new WeakMap<CSSStyleSheet, boolean>();
  sheetVerdicts.set(cap, verdicts);
  const sheets = [...Array.from(root.styleSheets ?? []), ...(root.adoptedStyleSheets ?? [])];
  return sheets.some((sheet) => {
    let uses = verdicts.get(sheet);
    if (uses === undefined) {
      const rules = sheetRules(sheet);
      uses = rules !== null && rulesUseCounters(rules, 0);
      verdicts.set(sheet, uses);
    }
    return uses;
  });
}

/**
 * The counter pass over `el`'s document or shadow root. A new pass starts right away when the
 * root's style sheets use counters, so the walk counts alongside from the first element.
 */
function indexOf(cap: Capture, el: Element): CounterIndex {
  const root = el.getRootNode() as Document | ShadowRoot;
  let index = cap.counters.get(root);
  if (!index) {
    index = { root, values: new Map(), progress: new Map(), stacks: new Map(), open: 0, path: [], started: false };
    if (sheetsUseCounters(cap, root)) start(index);
    cap.counters.set(root, index);
  }
  return index;
}

/**
 * Counts the counters of `el`'s root up to `el` (its ::before included) until the slice deadline
 * passes. The walk calls it before it renders an element, so the values its pseudo-elements need
 * are counted in slices (skimmed content past the cut is only counted when something after it is
 * rendered). Returns false when the deadline passed first.
 */
export function countersReady(cap: Capture, el: Element): boolean {
  const index = indexOf(cap, el);
  if (!index.started) return true;
  while (!index.progress.has(el) && step(cap, index)) {
    if (now() >= cap.slice.deadline) return index.progress.has(el);
  }
  return true;
}

const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

/** Formats a counter value in a list-style-type; unknown styles fall back to decimal. */
export function formatCounter(value: number, style: string): string {
  switch (style) {
    case "none":
      return "";
    case "disc":
      return "•";
    case "circle":
      return "◦";
    case "square":
      return "▪";
    case "decimal-leading-zero":
      return value >= 0 && value < 10 ? `0${value}` : String(value);
    case "lower-roman":
    case "upper-roman": {
      if (value < 1 || value > 3999) return String(value);
      let out = "";
      let rest = value;
      for (const [n, s] of ROMAN) {
        while (rest >= n) {
          out += s;
          rest -= n;
        }
      }
      return style === "upper-roman" ? out.toUpperCase() : out;
    }
    case "lower-alpha":
    case "lower-latin":
    case "upper-alpha":
    case "upper-latin": {
      if (value < 1) return String(value);
      let out = "";
      for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(97 + ((n - 1) % 26)) + out;
      return style.startsWith("upper") ? out.toUpperCase() : out;
    }
    default:
      return String(value);
  }
}

/**
 * Reader for the counters in scope at `el`'s ::before / ::after. Whatever the walk has not counted
 * yet is counted now: little, since the walk keeps the pass level with itself (countersReady).
 */
export function counterReader(cap: Capture, el: Element, which: "before" | "after"): CounterReader {
  const index = indexOf(cap, el);
  if (!index.started) start(index);
  const want = which === "before" ? BEFORE : AFTER;
  while ((index.progress.get(el) ?? 0) < want) if (!step(cap, index)) break;
  // A reversed counter without a start value is known only once its whole scope is counted.
  while (index.open > 0) if (!step(cap, index)) break;
  const values = index.values.get(el)?.[which];
  return (name, separator, style) => {
    const nested = values?.get(name) ?? [0];
    if (separator === null) return formatCounter(nested.at(-1) ?? 0, style);
    return nested.map((v) => formatCounter(v, style)).join(separator);
  };
}
