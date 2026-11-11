import { viewOf } from "../dom/env";
import { type Capture, infoOf } from "./state";

/**
 * CSS counters for ::before / ::after content. The computed `content` only says `counter(step)`, so
 * the values are replayed with one tree-order pass over the counter properties (reset, then increment,
 * then set; a sibling's reset replaces the counter, a descendant's nests it), including the implicit
 * `list-item` counter of HTML lists.
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

/** Counter values at the pseudo-elements of one document or shadow root that use counters. */
export type CounterIndex = Map<Element, { before?: CounterValues; after?: CounterValues }>;

const LISTS: ReadonlySet<string> = new Set(["ol", "ul", "menu"]);

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

/** Builds the index of counter values at every pseudo-element whose content uses a counter. */
function buildIndex(cap: Capture, root: Document | ShadowRoot): CounterIndex {
  const index: CounterIndex = new Map();
  const stacks = new Map<string, Instance[]>();
  const stackOf = (name: string): Instance[] => {
    let stack = stacks.get(name);
    if (!stack) {
      stack = [];
      stacks.set(name, stack);
    }
    return stack;
  };
  /** The innermost counter `name` in scope; a missing counter is created at 0. */
  const current = (name: string, owner: Node): Instance => {
    const stack = stackOf(name);
    const top = stack.at(-1);
    if (top) return top;
    const created = { value: 0, owner };
    stack.push(created);
    return created;
  };
  const apply = (cs: CSSStyleDeclaration, owner: Node, el: Element | null, listItem: boolean) => {
    const reset = pairs(cs.counterReset, 0);
    const inc = pairs(cs.counterIncrement, 1);
    const set = pairs(cs.counterSet, 0);
    if (el && LISTS.has(el.localName) && !has(reset, "list-item")) {
      const start = Number.parseInt(el.getAttribute("start") ?? "", 10);
      reset.push(["list-item", el.localName === "ol" && Number.isFinite(start) ? start - 1 : 0]);
    }
    if (listItem && !has(inc, "list-item")) inc.push(["list-item", 1]);
    for (const [name, v] of reset) {
      const stack = stackOf(name);
      const top = stack.at(-1);
      if (top?.owner === owner) top.value = v;
      else stack.push({ value: v, owner });
    }
    for (const [name, v] of inc) current(name, owner).value += v;
    for (const [name, v] of set) current(name, owner).value = v;
  };
  const pseudo = (el: Element, which: "before" | "after") => {
    const cs = viewOf(el).getComputedStyle(el, `::${which}`);
    const content = cs.content;
    if (!content || content === "none" || content === "normal" || cs.display === "none") return;
    apply(cs, el, null, false);
    if (!content.includes("counter")) return;
    const values = new Map<string, number[]>();
    for (const [name, stack] of stacks) {
      const nested = stack.map((i) => i.value);
      if (nested.length > 0) values.set(name, nested);
    }
    const entry = index.get(el) ?? {};
    entry[which] = values;
    index.set(el, entry);
  };
  const visit = (el: Element) => {
    const info = infoOf(cap, el);
    if (info.display === "none") return;
    apply(info.cs, el.parentNode ?? root, el, info.display.includes("list-item"));
    pseudo(el, "before");
    for (const child of Array.from(el.children)) visit(child);
    pseudo(el, "after");
    for (const stack of stacks.values()) while (stack.at(-1)?.owner === el) stack.pop();
  };
  for (const child of Array.from(root.children)) visit(child);
  return index;
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

/** Reader for the counters in scope at `el`'s ::before / ::after (one document pass per snapshot and root). */
export function counterReader(cap: Capture, el: Element, which: "before" | "after"): CounterReader {
  const root = el.getRootNode() as Document | ShadowRoot;
  let index = cap.counters.get(root);
  if (!index) {
    index = buildIndex(cap, root);
    cap.counters.set(root, index);
  }
  const values = index.get(el)?.[which];
  return (name, separator, style) => {
    const nested = values?.get(name) ?? [0];
    if (separator === null) return formatCounter(nested.at(-1) ?? 0, style);
    return nested.map((v) => formatCounter(v, style)).join(separator);
  };
}
