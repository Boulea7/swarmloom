import { parseLength, SVG_NS, XLINK_NS } from "./units";

/**
 * `<use>` expansion and source keys.
 *
 * Every element gets a `data-sl-key` naming its original. Expanding a `<use>` clones the
 * referenced content in place (wrapped in groups that carry the use's attributes and its x/y
 * translation), so clones keep the key of their original: the converter turns the first layer of
 * a key into the master of later ones (built as alt-drag duplicates).
 */

export const KEY_ATTR = "data-sl-key";
const DEPTH_ATTR = "data-sl-depth";
/** Uses inside these containers stay as they are (clip paths cannot hold groups). */
const KEEP_USES_IN = new Set(["clipPath"]);
const MAX_DEPTH = 12;

export interface ExpandResult {
  /** Number of `<use>` elements replaced by their content. */
  expanded: number;
  /** Uses dropped because of the clone budget, depth limit or invalid/cyclic references. */
  dropped: number;
}

/** Assigns a stable source key to every element (document order). */
export function assignKeys(root: Element): void {
  let n = 0;
  root.setAttribute(KEY_ATTR, String(n++));
  for (const el of Array.from(root.getElementsByTagName("*"))) el.setAttribute(KEY_ATTR, String(n++));
}

function hrefOf(el: Element): string {
  return (el.getAttribute("href") ?? el.getAttributeNS(XLINK_NS, "href") ?? "").trim();
}

function depthOf(el: Element): number {
  for (let p: Element | null = el.parentElement; p; p = p.parentElement) {
    const d = p.getAttribute(DEPTH_ATTR);
    if (d !== null) return Number(d) || 0;
  }
  return 0;
}

function insideKeptContainer(el: Element): boolean {
  for (let p: Element | null = el.parentElement; p; p = p.parentElement) {
    if (KEEP_USES_IN.has(p.localName)) return true;
  }
  return false;
}

function stripIds(el: Element): void {
  el.removeAttribute("id");
  for (const d of Array.from(el.getElementsByTagName("*"))) d.removeAttribute("id");
}

/** Builds the instance content for `ref` as referenced by `use`. */
function instanceContent(doc: Document, use: Element, ref: Element): Element {
  const width = use.getAttribute("width");
  const height = use.getAttribute("height");
  if (ref.localName === "symbol") {
    const svg = doc.createElementNS(SVG_NS, "svg");
    for (const attr of Array.from(ref.attributes)) {
      if (attr.localName !== "id") svg.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
    svg.setAttribute("width", width && width !== "auto" ? width : (ref.getAttribute("width") ?? "100%"));
    svg.setAttribute("height", height && height !== "auto" ? height : (ref.getAttribute("height") ?? "100%"));
    for (const child of Array.from(ref.childNodes)) svg.appendChild(child.cloneNode(true));
    return svg;
  }
  const clone = ref.cloneNode(true) as Element;
  if (ref.localName === "svg") {
    if (width && width !== "auto") clone.setAttribute("width", width);
    if (height && height !== "auto") clone.setAttribute("height", height);
  }
  return clone;
}

function buildIdMap(root: Element): Map<string, Element> {
  const byId = new Map<string, Element>();
  for (const el of Array.from(root.querySelectorAll("[id]"))) {
    const id = el.getAttribute("id") ?? "";
    if (!byId.has(id)) byId.set(id, el);
  }
  return byId;
}

/**
 * Replaces `<use>` elements with clones of what they reference, outermost first, until none are
 * left or `maxClones` cloned elements have been created. Uses inside clip paths are kept.
 */
export function expandUses(root: Element, maxClones = 20_000): ExpandResult {
  const doc = root.ownerDocument;
  const byId = buildIdMap(root);
  const result: ExpandResult = { expanded: 0, dropped: 0 };
  let budget = maxClones;
  const pending = Array.from(root.getElementsByTagNameNS(SVG_NS, "use"));

  for (let i = 0; i < pending.length; i++) {
    const use = pending[i] as Element;
    if (!root.contains(use) || insideKeptContainer(use)) continue;
    const href = hrefOf(use);
    const ref = href.startsWith("#") ? byId.get(href.slice(1)) : undefined;
    const depth = depthOf(use) + 1;
    const cost = ref ? ref.getElementsByTagName("*").length + 1 : 0;
    if (!ref || ref.contains(use) || depth > MAX_DEPTH || cost > budget) {
      use.remove();
      result.dropped++;
      continue;
    }
    budget -= cost;

    const outer = doc.createElementNS(SVG_NS, "g");
    for (const attr of Array.from(use.attributes)) {
      const name = attr.localName;
      if (name === "x" || name === "y" || name === "width" || name === "height" || name === "href" || name === "id") {
        continue;
      }
      outer.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
    outer.setAttribute(DEPTH_ATTR, String(depth));
    // x/y translate after the use's own transform (SVG 2, 5.6.2), hence a nested group.
    const x = parseLength(use.getAttribute("x")) ?? 0;
    const y = parseLength(use.getAttribute("y")) ?? 0;
    let parent: Element = outer;
    if (x !== 0 || y !== 0) {
      const inner = doc.createElementNS(SVG_NS, "g");
      inner.setAttribute("transform", `translate(${x} ${y})`);
      outer.appendChild(inner);
      parent = inner;
    }
    const content = instanceContent(doc, use, ref);
    stripIds(content);
    parent.appendChild(content);
    use.replaceWith(outer);
    result.expanded++;
    // Uses inside the new instance are processed after the current queue (outermost first).
    for (const nested of Array.from(outer.getElementsByTagNameNS(SVG_NS, "use"))) pending.push(nested);
  }
  return result;
}
