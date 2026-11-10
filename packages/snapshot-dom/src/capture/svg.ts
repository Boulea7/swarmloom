import { isElement, isText, SVG_NS, viewOf } from "../dom/env";
import { escapeAttr, escapeText, safeImageUrl } from "../util/html";

/** SVG elements kept in serialised output. Scripts and foreignObject are dropped. */
const ALLOWED = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "defs",
  "symbol",
  "use",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "image",
  "switch",
  "a",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
]);

/**
 * SMIL animation elements kept so the drawing can replay its own animation once built
 * (decisions-v1 C04). Their hrefs are `#fragment`-only like everywhere else.
 */
const ANIMATION = new Set(["animate", "animateTransform", "animateMotion", "set", "mpath"]);
/** Animation values may only reference local fragments. */
const EXTERNAL_URL = /url\(\s*["']?(?!#)/i;
const SCRIPT_URL = /(?:javascript|vbscript|data):/i;

/** Inherited SVG presentation properties: written where they differ from the parent. */
const INHERITED = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "visibility",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "letter-spacing",
  "marker-start",
  "marker-mid",
  "marker-end",
] as const;

/** Non-inherited properties: written where they differ from the initial value. */
const OWN: Readonly<Record<string, string>> = {
  opacity: "1",
  "stop-color": "rgb(0, 0, 0)",
  "stop-opacity": "1",
  "dominant-baseline": "auto",
  filter: "none",
  "clip-path": "none",
  mask: "none",
  "mix-blend-mode": "normal",
};

/** Initial values used as the parent of the root element. */
const ROOT_PARENT: Readonly<Record<string, string>> = {
  fill: "rgb(0, 0, 0)",
  "fill-opacity": "1",
  "fill-rule": "nonzero",
  stroke: "none",
  "stroke-width": "1px",
  "stroke-opacity": "1",
  "stroke-linecap": "butt",
  "stroke-linejoin": "miter",
  "stroke-dasharray": "none",
  "stroke-dashoffset": "0px",
  "stroke-miterlimit": "4",
  visibility: "visible",
  "text-anchor": "start",
  "letter-spacing": "normal",
  "marker-start": "none",
  "marker-mid": "none",
  "marker-end": "none",
};

/** Elements whose computed styles are baked into the output; beyond this only attributes are kept. */
const STYLE_BUDGET = 1500;
/** Hard cap on serialised elements; larger drawings become placeholders. */
const NODE_LIMIT = 6000;

const LOCAL_REF = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/g;

export interface SvgOptions {
  /** Layout size written as width/height of the root element. */
  width: number;
  height: number;
  /** Unique id prefix (avoids clashes when several SVGs share one stage). */
  prefix: string;
  /** Extra inline style on the root element (vertical-align etc. when used inline in text). */
  rootStyle?: string;
  /** Base URL for <image> hrefs. */
  base: string;
}

interface State {
  opts: SvgOptions;
  out: string[];
  nodes: number;
  styled: number;
  emittedIds: Set<string>;
  wantedIds: Set<string>;
  animated: boolean;
  root: Node;
  view: Window;
}

type Props = Record<string, string>;

function readProps(st: State, el: Element): Props | null {
  if (st.styled >= STYLE_BUDGET) return null;
  st.styled++;
  const cs = st.view.getComputedStyle(el);
  const out: Props = { display: cs.display, color: cs.color, transform: cs.transform };
  for (const p of INHERITED) out[p] = cs.getPropertyValue(p);
  for (const p of Object.keys(OWN)) out[p] = cs.getPropertyValue(p);
  return out;
}

function prefixRefs(st: State, value: string): string {
  return value.replace(LOCAL_REF, (_m, id: string) => {
    st.wantedIds.add(id);
    return `url(#${st.opts.prefix}${id})`;
  });
}

function styleDiff(st: State, own: Props, parent: Props, hasTransformAttr: boolean): string {
  const parts: string[] = [];
  for (const p of INHERITED) {
    const v = own[p] ?? "";
    if (v && v !== (parent[p] ?? "")) parts.push(`${p}:${prefixRefs(st, v)}`);
  }
  for (const [p, initial] of Object.entries(OWN)) {
    const v = own[p] ?? "";
    if (v && v !== initial) parts.push(`${p}:${prefixRefs(st, v)}`);
  }
  const t = own.transform ?? "none";
  if (!hasTransformAttr && t && t !== "none") parts.push(`transform:${t}`);
  return parts.join(";");
}

function refId(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.startsWith("#") && v.length > 1 ? v.slice(1) : null;
}

function lookup(st: State, id: string): Element | null {
  const root = st.root as Document | ShadowRoot;
  const found = typeof root.getElementById === "function" ? root.getElementById(id) : null;
  if (found) return found;
  const doc = (st.root as Node).ownerDocument;
  return doc ? doc.getElementById(id) : null;
}

function attrsOf(st: State, el: Element, skip: ReadonlySet<string>): string {
  let s = "";
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    const lower = name.toLowerCase();
    if (skip.has(lower) || lower.startsWith("on") || lower === "style" || lower === "class") continue;
    if (lower.startsWith("data-") || lower.startsWith("aria-") || lower === "role" || lower === "tabindex") continue;
    let value = attr.value;
    if (lower === "id") {
      st.emittedIds.add(value);
      value = st.opts.prefix + value;
    } else if (lower === "href" || lower === "xlink:href") {
      const id = refId(value);
      if (id) {
        st.wantedIds.add(id);
        value = `#${st.opts.prefix}${id}`;
      } else if (el.localName === "image" || el.localName === "feImage") {
        const safe = safeImageUrl(value, st.opts.base);
        if (!safe) continue;
        value = safe;
      } else {
        continue;
      }
      s += ` href="${escapeAttr(value)}"`;
      continue;
    } else if (value.includes("url(")) {
      value = prefixRefs(st, value);
    }
    if (/^\s*(?:javascript|vbscript|data):/i.test(value) && lower !== "d") continue;
    s += ` ${name}="${escapeAttr(value)}"`;
  }
  return s;
}

const NO_SKIP: ReadonlySet<string> = new Set();
/** The root's own geometry and transform are carried by the layer box (and Layer.transform). */
const ROOT_SKIP: ReadonlySet<string> = new Set([
  "width",
  "height",
  "x",
  "y",
  "xmlns",
  "xmlns:xlink",
  "version",
  "transform",
]);
const USE_SKIP: ReadonlySet<string> = new Set(["href", "xlink:href", "x", "y", "width", "height"]);

function walk(st: State, el: Element, parent: Props | null, depth: number): void {
  if (st.nodes >= NODE_LIMIT || depth > 64) return;
  const tag = el.localName;
  if (el.namespaceURI !== SVG_NS || !(ALLOWED.has(tag) || ANIMATION.has(tag))) return;
  st.nodes++;
  if (ANIMATION.has(tag)) {
    writeAnimation(st, el, depth);
    return;
  }
  const own = readProps(st, el);
  if (own?.display === "none" && tag !== "symbol" && tag !== "defs" && !isDefinition(tag)) return;
  if (tag === "use") {
    writeUse(st, el, own, parent, depth);
    return;
  }
  const name = tag === "a" ? "g" : tag;
  const style = own && parent ? styleDiff(st, own, parent, el.hasAttribute("transform")) : "";
  st.out.push(`<${name}${attrsOf(st, el, NO_SKIP)}${style ? ` style="${escapeAttr(style)}"` : ""}>`);
  writeChildren(st, el, own ?? parent, depth);
  st.out.push(`</${name}>`);
}

/** Animations that could navigate, run handlers or load external resources. */
function unsafeAnimation(el: Element): boolean {
  const target = (el.getAttribute("attributeName") ?? "").trim().toLowerCase();
  if (target === "href" || target === "xlink:href" || target.startsWith("on")) return true;
  for (const name of ["values", "from", "to", "by"]) {
    const v = el.getAttribute(name);
    if (v && (EXTERNAL_URL.test(v) || SCRIPT_URL.test(v))) return true;
  }
  return false;
}

/** Writes a SMIL element with its attributes only (computed styles do not apply to it). */
function writeAnimation(st: State, el: Element, depth: number): void {
  if (unsafeAnimation(el)) return;
  const tag = el.localName;
  if (tag !== "mpath") st.animated = true;
  st.out.push(`<${tag}${attrsOf(st, el, NO_SKIP)}>`);
  for (const child of Array.from(el.children)) if (child.localName === "mpath") walk(st, child, null, depth + 1);
  st.out.push(`</${tag}>`);
}

function isDefinition(tag: string): boolean {
  return (
    tag === "linearGradient" ||
    tag === "radialGradient" ||
    tag === "clipPath" ||
    tag === "mask" ||
    tag === "pattern" ||
    tag === "marker" ||
    tag === "filter"
  );
}

function writeChildren(st: State, el: Element, props: Props | null, depth: number): void {
  for (const child of Array.from(el.childNodes)) {
    if (isText(child)) st.out.push(escapeText(child.data));
    else if (isElement(child)) walk(st, child, props, depth + 1);
  }
}

/** Inlines a `<use>` reference: symbols become nested svg viewports, other targets a translated group. */
function writeUse(st: State, use: Element, own: Props | null, parent: Props | null, depth: number): void {
  const id = refId(use.getAttribute("href") ?? use.getAttribute("xlink:href"));
  const target = id ? lookup(st, id) : null;
  if (!target || target.namespaceURI !== SVG_NS || depth > 16) return;
  const style = own && parent ? styleDiff(st, own, parent, use.hasAttribute("transform")) : "";
  const x = use.getAttribute("x") ?? "0";
  const y = use.getAttribute("y") ?? "0";
  const translate = x !== "0" || y !== "0" ? ` transform="translate(${escapeAttr(x)} ${escapeAttr(y)})"` : "";
  st.out.push(`<g${attrsOf(st, use, USE_SKIP)}${translate}${style ? ` style="${escapeAttr(style)}"` : ""}>`);
  // Content inherits from the <use>, so it is written without its own inherited diffs.
  const inherited = own ?? parent;
  if (target.localName === "symbol") {
    const w = use.getAttribute("width") ?? "100%";
    const h = use.getAttribute("height") ?? "100%";
    const vb = target.getAttribute("viewBox");
    const par = target.getAttribute("preserveAspectRatio");
    st.out.push(
      `<svg width="${escapeAttr(w)}" height="${escapeAttr(h)}"${vb ? ` viewBox="${escapeAttr(vb)}"` : ""}${par ? ` preserveAspectRatio="${escapeAttr(par)}"` : ""} overflow="visible">`,
    );
    writeChildren(st, target, inherited, depth + 1);
    st.out.push("</svg>");
  } else {
    walk(st, target, inherited, depth + 1);
  }
  st.out.push("</g>");
}

/** Standalone markup of an inline SVG. */
export interface SvgMarkup {
  markup: string;
  /** The drawing keeps SMIL animation elements. */
  animated: boolean;
}

/**
 * Serialises an inline `<svg>` into standalone, script-free markup:
 * computed presentation styles are baked in (class-based styling survives), local `<use>`
 * references are inlined, `url(#id)` targets defined elsewhere in the document are copied into
 * `<defs>`, and every id is prefixed so several copies can coexist in one shadow root. SMIL
 * animations are kept unless they target links or handlers or reference external resources.
 * Returns null when the drawing exceeds the node limit.
 */
export function serializeSvg(svg: Element, opts: SvgOptions): SvgMarkup | null {
  const view = viewOf(svg);
  const st: State = {
    opts,
    out: [],
    nodes: 0,
    styled: 0,
    emittedIds: new Set(),
    wantedIds: new Set(),
    animated: false,
    root: svg.getRootNode(),
    view,
  };
  const own = readProps(st, svg);
  const color = own?.color ?? "currentColor";
  const rootStyle = [`color:${color}`, own ? styleDiff(st, own, { ...ROOT_PARENT }, true) : "", opts.rootStyle ?? ""]
    .filter((s) => s.length > 0)
    .join(";");
  const vb = svg.getAttribute("viewBox");
  const head = `<svg xmlns="${SVG_NS}" width="${round(opts.width)}" height="${round(opts.height)}"${vb ? "" : ` viewBox="0 0 ${round(opts.width)} ${round(opts.height)}"`}${attrsOf(st, svg, ROOT_SKIP)} style="${escapeAttr(rootStyle)}">`;
  writeChildren(st, svg, own, 0);
  // Copy referenced definitions that live outside this drawing (shared sprite sheets, gradients).
  const defs: string[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const missing = [...st.wantedIds].filter((id) => !st.emittedIds.has(id));
    if (missing.length === 0) break;
    const body = st.out;
    st.out = defs;
    for (const id of missing) {
      st.emittedIds.add(id);
      const target = lookup(st, id);
      if (target && target.namespaceURI === SVG_NS && target.localName !== "symbol") walk(st, target, null, 1);
    }
    st.out = body;
  }
  if (st.nodes >= NODE_LIMIT) return null;
  const defsMarkup = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";
  return { markup: `${head}${defsMarkup}${st.out.join("")}</svg>`, animated: st.animated };
}

function round(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** `data:` URL for an SVG document string. */
export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}
