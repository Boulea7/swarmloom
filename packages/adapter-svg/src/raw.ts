import { IDENTITY, type Matrix } from "./path/geometry";
import { computedStyle, INLINE_PROPS, rewriteUrls } from "./style";
import { SVG_NS, XLINK_NS } from "./units";

/**
 * Verbatim copies of sandbox elements for use outside the sandbox (stage defs, standalone
 * snapshots). Each copy carries its computed presentation inline (class selectors and `<style>`
 * rules do not travel), drops ids/classes, and has every `url(#id)` / `href="#id"` remapped to a
 * copy of the referenced element appended to the output `<defs>` once.
 */

const MAX_DEPTH = 64;
const MAX_CHAIN = 16;
const SKIP_CHILDREN = new Set(["style", "title", "desc"]);
const GRADIENTS = new Set(["linearGradient", "radialGradient"]);
const INLINE_NAMES = new Set(INLINE_PROPS.map(([p]) => p));

export function hrefOf(el: Element): string {
  return (el.getAttribute("href") ?? el.getAttributeNS(XLINK_NS, "href") ?? "").trim();
}

/** `el` followed by the elements it inherits from through `href` (same family only, cycle-safe). */
export function hrefChain(el: Element, byId: ReadonlyMap<string, Element>, family: ReadonlySet<string>): Element[] {
  const chain = [el];
  let cur = el;
  while (chain.length < MAX_CHAIN) {
    const href = hrefOf(cur);
    if (!href.startsWith("#")) break;
    const next = byId.get(href.slice(1));
    if (!next || chain.includes(next) || !family.has(next.localName)) break;
    chain.push(next);
    cur = next;
  }
  return chain;
}

export function firstAttr(chain: readonly Element[], name: string): string | null {
  for (const el of chain) {
    const v = el.getAttribute(name);
    if (v !== null) return v;
  }
  return null;
}

function elementChildren(el: Element, tag?: string): Element[] {
  return Array.from(el.children).filter((c) => (tag ? c.localName === tag : !SKIP_CHILDREN.has(c.localName)));
}

/** Gradient stops from the first element of the chain that has any. */
export function stopsOf(chain: readonly Element[]): Element[] {
  for (const el of chain) {
    const stops = elementChildren(el, "stop");
    if (stops.length > 0) return stops;
  }
  return [];
}

/** Pattern content from the first element of the chain that has any. */
export function patternContentOf(chain: readonly Element[]): Element[] {
  for (const el of chain) {
    const kids = elementChildren(el);
    if (kids.length > 0) return kids;
  }
  return [];
}

type TransformHost = { transform?: SVGAnimatedTransformList };

/**
 * Consolidated transform list of the first chain element that has attribute `name`
 * (`transform`, `gradientTransform` or `patternTransform`); identity otherwise.
 */
export function transformOf(chain: readonly Element[], name: string): Matrix {
  for (const el of chain) {
    if (!el.hasAttribute(name)) continue;
    const list = (el as unknown as Record<string, TransformHost["transform"]>)[name];
    const m = list?.baseVal?.consolidate()?.matrix;
    return m ? [m.a, m.b, m.c, m.d, m.e, m.f] : IDENTITY;
  }
  return IDENTITY;
}

/** Gradient stop offset: number or percentage, clamped to 0..1. */
export function parseOffset(value: string | null): number {
  if (!value) return 0;
  const v = value.trim();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  const f = v.endsWith("%") ? n / 100 : n;
  return Math.min(1, Math.max(0, f));
}

/** Builds a `<stop>` copy with offset and computed colour inlined. Offsets are kept monotonic. */
export function copyStop(doc: Document, stop: Element, minOffset: number): [Element, number] {
  const out = doc.createElementNS(SVG_NS, "stop");
  const offset = Math.max(minOffset, parseOffset(stop.getAttribute("offset")));
  out.setAttribute("offset", String(offset));
  const cs = computedStyle(stop);
  out.setAttribute("stop-color", cs.getPropertyValue("stop-color") || "black");
  const opacity = cs.getPropertyValue("stop-opacity");
  if (opacity && opacity !== "1") out.setAttribute("stop-opacity", opacity);
  return [out, offset];
}

export class RawCopier {
  private readonly map = new Map<string, string>();

  /**
   * @param byId - Sandbox elements by id (first occurrence wins, as in browsers).
   * @param out - Output `<defs>` receiving referenced copies.
   * @param newId - Generates unique ids for copies.
   */
  constructor(
    private readonly byId: ReadonlyMap<string, Element>,
    private readonly out: Element,
    private readonly newId: (kind: string) => string,
  ) {}

  private get doc(): Document {
    return this.out.ownerDocument;
  }

  /** Copies the element with source id `id` into the output defs (once); returns its new id. */
  ref(id: string): string | null {
    const known = this.map.get(id);
    if (known) return known;
    const src = this.byId.get(id);
    if (!src) return null;
    const nid = this.newId("r");
    // Register before copying so reference cycles terminate.
    this.map.set(id, nid);
    const copy = GRADIENTS.has(src.localName)
      ? this.flattenGradient(src)
      : src.localName === "pattern"
        ? this.flattenPattern(src)
        : this.clone(src);
    copy.setAttribute("id", nid);
    this.out.appendChild(copy);
    return nid;
  }

  /** Deep copy of `src` with inlined computed styles and remapped references. */
  clone(src: Element, opts: { dropTransform?: boolean } = {}): Element {
    const root = this.shallow(src, opts.dropTransform === true);
    const stack: Array<[Element, Element, number]> = [[src, root, 0]];
    while (stack.length > 0) {
      const [s, c, depth] = stack.pop() as [Element, Element, number];
      if (depth >= MAX_DEPTH) continue;
      for (const child of Array.from(s.childNodes)) {
        if (child.nodeType === 3 || child.nodeType === 4) {
          c.appendChild(this.doc.createTextNode(child.textContent ?? ""));
        } else if (child.nodeType === 1) {
          const el = child as Element;
          if (SKIP_CHILDREN.has(el.localName)) continue;
          const copy = this.shallow(el, false);
          c.appendChild(copy);
          stack.push([el, copy, depth + 1]);
        }
      }
    }
    return root;
  }

  private shallow(src: Element, dropTransform: boolean): Element {
    const c = this.doc.createElementNS(SVG_NS, src.localName);
    for (const attr of Array.from(src.attributes)) {
      const name = attr.localName;
      if (name === "id" || name === "class" || name === "style" || name.startsWith("data-")) continue;
      if (dropTransform && name === "transform") continue;
      if (INLINE_NAMES.has(name) || name === "color") continue;
      if (name === "href") {
        const v = attr.value.trim();
        if (v.startsWith("#")) {
          const mapped = this.ref(v.slice(1));
          if (mapped) c.setAttribute("href", `#${mapped}`);
        } else if (v.startsWith("data:")) {
          c.setAttribute("href", v);
        }
        continue;
      }
      const value = attr.value.includes("url(") ? rewriteUrls(attr.value, (id) => this.ref(id)) : attr.value;
      c.setAttributeNS(attr.namespaceURI === XLINK_NS ? null : attr.namespaceURI, attr.localName, value);
    }
    const style = this.inlineStyle(src);
    if (style) c.setAttribute("style", style);
    return c;
  }

  private inlineStyle(src: Element): string {
    const cs = computedStyle(src);
    const parts: string[] = [];
    if (cs.display === "none") parts.push("display:none");
    for (const [prop, initial] of INLINE_PROPS) {
      let v = prop === "mask" ? maskValue(cs) : cs.getPropertyValue(prop);
      if (!v || v === initial) continue;
      if (v.includes("url(")) v = rewriteUrls(v, (id) => this.ref(id));
      parts.push(`${prop}:${v}`);
    }
    return parts.join(";");
  }

  /** Gradient with inherited attributes and stops resolved (units and transform kept as is). */
  private flattenGradient(src: Element): Element {
    const chain = hrefChain(src, this.byId, GRADIENTS);
    const out = this.doc.createElementNS(SVG_NS, src.localName);
    const names =
      src.localName === "linearGradient"
        ? ["x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod"]
        : ["cx", "cy", "r", "fx", "fy", "fr", "gradientUnits", "gradientTransform", "spreadMethod"];
    for (const name of names) {
      const v = firstAttr(chain, name);
      if (v !== null) out.setAttribute(name, v);
    }
    let min = 0;
    for (const stop of stopsOf(chain)) {
      const [copy, offset] = copyStop(this.doc, stop, min);
      min = offset;
      out.appendChild(copy);
    }
    return out;
  }

  /** Pattern with inherited attributes and content resolved. */
  private flattenPattern(src: Element): Element {
    const chain = hrefChain(src, this.byId, new Set(["pattern"]));
    const out = this.doc.createElementNS(SVG_NS, "pattern");
    for (const name of [
      "x",
      "y",
      "width",
      "height",
      "patternUnits",
      "patternContentUnits",
      "patternTransform",
      "viewBox",
      "preserveAspectRatio",
    ]) {
      const v = firstAttr(chain, name);
      if (v !== null) out.setAttribute(name, v);
    }
    for (const child of patternContentOf(chain)) out.appendChild(this.clone(child));
    return out;
  }
}

/** The computed SVG mask reference of an element (`mask-image` in current engines, `mask` before). */
export function maskValue(cs: CSSStyleDeclaration): string {
  const image = cs.getPropertyValue("mask-image");
  if (image && image !== "none") return image;
  const legacy = cs.getPropertyValue("mask");
  return legacy.includes("url(") ? legacy : "none";
}
