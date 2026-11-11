import { now } from "../util/slice";
import { pseudoStyleOf } from "./pseudo-style";
import { type Capture, type ElInfo, infoOf } from "./state";

/**
 * CSS counters for ::before / ::after content. The computed `content` only says `counter(step)`, so
 * the values are replayed with one tree-order pass over the counter properties (reset, then increment,
 * then set; a sibling's reset replaces the counter, a descendant's nests it), including the implicit
 * `list-item` counter of HTML lists. The pass is resumable: the walk advances it under its slice
 * deadline (countersReady), so a page full of counters is never counted in one long task.
 */

/** Counter values in scope at one pseudo-element: name -> nested values, outermost first. */
export type CounterValues = ReadonlyMap<string, readonly number[]>;

/** Formats `counter(name, style)` (separator null) or `counters(name, separator, style)`. */
export type CounterReader = (name: string, separator: string | null, style: string) => string;

interface Instance {
  value: number;
  /** The scope ends after this node's subtree (the parent of the element that created it). */
  owner: Node;
}

type Pairs = [string, number][];

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
  /** Open elements, root first: empty before the pass starts and once it is finished. */
  readonly path: Frame[];
  started: boolean;
}

const LISTS: ReadonlySet<string> = new Set(["ol", "ul", "menu"]);

/** Content that puts a counter into a pseudo-element. */
const USES_COUNTER = /counters?\(/;

/** Parses a computed `counter-*` value such as `step 1 item 0` (missing numbers default to `fallback`). */
function pairs(value: string, fallback: number): Pairs {
  const out: Pairs = [];
  if (!value || value === "none") return out;
  for (const token of value.trim().split(/\s+/)) {
    const n = Number(token);
    const last = out.at(-1);
    if (/^[+-]?\d+$/.test(token) && last) last[1] = n;
    else out.push([token.replace(/^reversed\((.*)\)$/, "$1"), fallback]);
  }
  return out;
}

const has = (list: Pairs, name: string) => list.some(([n]) => n === name);

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
  const created = { value: 0, owner };
  stack.push(created);
  return created;
}

function apply(index: CounterIndex, cs: CSSStyleDeclaration, owner: Node, el: Element | null, listItem: boolean): void {
  const reset = pairs(cs.counterReset, 0);
  const inc = pairs(cs.counterIncrement, 1);
  const set = pairs(cs.counterSet, 0);
  if (el && LISTS.has(el.localName) && !has(reset, "list-item")) {
    const start = Number.parseInt(el.getAttribute("start") ?? "", 10);
    reset.push(["list-item", el.localName === "ol" && Number.isFinite(start) ? start - 1 : 0]);
  }
  if (listItem && !has(inc, "list-item")) inc.push(["list-item", 1]);
  for (const [name, v] of reset) {
    const stack = stackOf(index, name);
    const top = stack.at(-1);
    if (top?.owner === owner) top.value = v;
    else stack.push({ value: v, owner });
  }
  for (const [name, v] of inc) current(index, name, owner).value += v;
  for (const [name, v] of set) current(index, name, owner).value = v;
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
    for (const stack of index.stacks.values()) while (stack.at(-1)?.owner === done) stack.pop();
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

/** True when a readable style sheet of the root puts a counter into generated content. */
function sheetsUseCounters(root: Document | ShadowRoot): boolean {
  const sheets = [...Array.from(root.styleSheets ?? []), ...(root.adoptedStyleSheets ?? [])];
  return sheets.some((sheet) => {
    const rules = sheetRules(sheet);
    return rules !== null && rulesUseCounters(rules, 0);
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
    index = { root, values: new Map(), progress: new Map(), stacks: new Map(), path: [], started: false };
    if (sheetsUseCounters(root)) start(index);
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
  const values = index.values.get(el)?.[which];
  return (name, separator, style) => {
    const nested = values?.get(name) ?? [0];
    if (separator === null) return formatCounter(nested.at(-1) ?? 0, style);
    return nested.map((v) => formatCounter(v, style)).join(separator);
  };
}
