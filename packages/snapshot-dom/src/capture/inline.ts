import { FORM_TAGS, IGNORE_ATTR, isElement, isText, MATHML_NS, MEDIA_ATTR, MEDIA_TAGS, SKIP_TAGS } from "../dom/env";
import { px } from "../util/css";
import { isInlinePseudo, pseudoOf } from "./pseudo-info";
import { type Capture, childrenOf, type ElInfo, type FlatChild, type InlineFacts, infoOf, rectOf } from "./state";
import { paintsBox, visualOf } from "./styles";

/**
 * How a child takes part in its parent's content:
 *  - inline: flows in the parent's line boxes (text, inline elements, small icons) -> part of a text block
 *  - block: its own box (blocks, flex/grid items, form controls, large media) -> visited on its own
 *  - outflow: absolutely positioned / fixed / floating -> visited on its own, does not break text runs
 *  - skip: renders nothing
 */
export type ChildClass = "inline" | "block" | "outflow" | "skip";

/** Anything except whitespace and zero-width characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM). */
const INVISIBLE = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

/** True when the string contains a character that renders ink or advances (not just white space). */
export function hasVisibleText(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || INVISIBLE.has(c)) continue;
    if (
      c === 0x1680 ||
      (c >= 0x2000 && c <= 0x200a) ||
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0x202f ||
      c === 0x205f ||
      c === 0x3000
    )
      continue;
    return true;
  }
  return false;
}

export function isFlexOrGrid(display: string): boolean {
  return display.includes("flex") || display.includes("grid");
}

/** Images and SVGs small enough to read as an icon inside a line of text. */
function isIconAtom(info: ElInfo, parent: ElInfo): boolean {
  const tag = info.el.localName;
  if (tag !== "img" && tag !== "svg") return false;
  if (!info.display.startsWith("inline")) return false;
  const fs = px(parent.cs.fontSize, 16);
  const r = rectOf(info);
  return r.height <= Math.max(2.2 * fs, 32) && r.width <= Math.max(6 * fs, 96);
}

export function isMath(el: Element): boolean {
  return el.namespaceURI === MATHML_NS && el.localName === "math";
}

/** Classifies a flat child of `parent`. Reads styles through the per-snapshot cache. */
export function classify(cap: Capture, child: FlatChild, parent: ElInfo): ChildClass {
  const node = child.node;
  if (isText(node)) return "inline";
  if (!isElement(node)) return "skip";
  const tag = node.localName;
  if (SKIP_TAGS.has(tag) || node.hasAttribute(IGNORE_ATTR)) return "skip";
  const info = infoOf(cap, node);
  if (info.display === "none") return "skip";
  if (info.position === "absolute" || info.position === "fixed") return "outflow";
  if (info.float !== "none" && info.float !== "") return "outflow";
  if (node.hasAttribute(MEDIA_ATTR) || FORM_TAGS.has(tag) || tag === "button" || tag === "hr") return "block";
  if (MEDIA_TAGS.has(tag)) return isIconAtom(info, parent) ? "inline" : "block";
  if (isMath(node)) return info.display.includes("inline") ? "inline" : "block";
  const d = info.display;
  if (d === "inline" || d.startsWith("ruby")) return inlineFacts(cap, info).onlyInline ? "inline" : "block";
  if (d.startsWith("inline")) return atomicInlineClass(cap, info, parent);
  return "block";
}

/**
 * inline-block / inline-flex / inline-grid: stays inside the text block when it is a small
 * decoration (chip, kbd, badge); becomes its own box when it is a sizeable styled box such as a
 * button, so it is drawn as box + text.
 */
function atomicInlineClass(cap: Capture, info: ElInfo, parent: ElInfo): ChildClass {
  if (!inlineFacts(cap, info).onlyInline) return "block";
  if (isFlexOrGrid(info.display) && countTextItems(cap, info) > 1) return "block";
  const v = visualOf(info);
  if (paintsBox(v) || v.anySide) {
    const fs = px(parent.cs.fontSize, 16);
    if (rectOf(info).height > Math.max(28, 1.9 * fs)) return "block";
  }
  return "inline";
}

function isAtom(el: Element): boolean {
  return MEDIA_TAGS.has(el.localName) || isMath(el);
}

/**
 * Memoised facts about an element's content: whether every in-flow child is inline-level and
 * whether visible text is present (including ::before/::after text).
 */
export function inlineFacts(cap: Capture, info: ElInfo): InlineFacts {
  if (info.facts) return info.facts;
  const facts: InlineFacts = { onlyInline: true, hasText: false };
  info.facts = facts;
  for (const which of ["before", "after"] as const) {
    const p = pseudoOf(info, which);
    if (p && isInlinePseudo(p) && hasVisibleText(p.text)) facts.hasText = true;
  }
  for (const child of childrenOf(cap, info)) {
    const node = child.node;
    if (isText(node)) {
      if (!facts.hasText && hasVisibleText(node.data) && infoOf(cap, child.styleParent).visibility === "visible") {
        facts.hasText = true;
      }
      continue;
    }
    const cls = classify(cap, child, info);
    if (cls === "block") {
      facts.onlyInline = false;
      continue;
    }
    if (cls !== "inline" || !isElement(node) || isAtom(node)) continue;
    const sub = inlineFacts(cap, infoOf(cap, node));
    if (!sub.onlyInline) facts.onlyInline = false;
    if (sub.hasText && infoOf(cap, node).visibility !== "collapse") facts.hasText = true;
  }
  return facts;
}

/** Number of flex/grid items that carry text (adjacent text nodes form one anonymous item). */
export function countTextItems(cap: Capture, info: ElInfo): number {
  let count = 0;
  let inTextRun = false;
  for (const child of childrenOf(cap, info)) {
    const node = child.node;
    if (isText(node)) {
      if (hasVisibleText(node.data)) {
        if (!inTextRun) count++;
        inTextRun = true;
      }
      continue;
    }
    inTextRun = false;
    const cls = classify(cap, child, info);
    if (cls === "skip" || cls === "outflow" || !isElement(node) || isAtom(node)) continue;
    if (inlineFacts(cap, infoOf(cap, node)).hasText) count++;
  }
  return count;
}

/**
 * True when the element renders as one text block: all in-flow content is inline-level and some
 * of it is visible text. Flex/grid containers qualify only with at most one text-bearing item
 * (an icon + label button), so rows of links stay separate blocks.
 */
export function isTextLeaf(cap: Capture, info: ElInfo): boolean {
  const facts = inlineFacts(cap, info);
  if (!facts.onlyInline || !facts.hasText) return false;
  if (isFlexOrGrid(info.display) && countTextItems(cap, info) > 1) return false;
  return true;
}
