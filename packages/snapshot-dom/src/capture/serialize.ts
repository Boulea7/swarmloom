import type { CSSMap } from "@swarmloom/core";
import { IGNORE_ATTR, isElement, isHtmlElement, isSvgElement, isText, MATHML_NS, SKIP_TAGS, SVG_NS } from "../dom/env";
import { escapeAttr, escapeText, safeImageUrl, safeLinkUrl } from "../util/html";
import { imageUrlOf } from "./image-src";
import { classify, hasVisibleText, isFlexOrGrid, isMath, isVerbatim } from "./inline";
import { isInlinePseudo, pseudoOf } from "./pseudo-info";
import { type Capture, childrenOf, type ElInfo, type FlatChild, infoOf, rectOf } from "./state";
import {
  diffTextStyle,
  flexLayoutStyle,
  inlineBoxStyle,
  paintsBox,
  readBoxVisual,
  readTextProps,
  type TextProps,
  textPropsOf,
  visualOf,
} from "./styles";
import { serializeSvg, svgDataUrl } from "./svg";

/** Serialised inline content of a text block. */
export interface Fragment {
  html: string;
  /** Plain visible text with white-space collapsed as rendered. */
  text: string;
  /** Absolutely positioned / floating descendants met on the way; visited separately. */
  outflow: Element[];
  /** First non-empty text node (baseline measurement). */
  firstText: Text | null;
}

/** Upper bound of one fragment's markup; content beyond it is dropped. */
const HTML_BUDGET = 400_000;

interface Ser {
  readonly cap: Capture;
  readonly base: string;
  readonly html: string[];
  readonly text: string[];
  readonly outflow: Element[];
  size: number;
  /** Last text character written was collapsible white space (or a line start). */
  pendingSpace: boolean;
  preserved: boolean;
  firstText: Text | null;
}

/** Tags kept as-is because layout depends on them; every other inline element becomes a span. */
const KEEP_TAGS = new Set(["ruby", "rt", "rp", "rb"]);

const MATH_TAGS = new Set([
  "math",
  "mrow",
  "mi",
  "mn",
  "mo",
  "ms",
  "mtext",
  "mspace",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "munder",
  "mover",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "mstyle",
  "mpadded",
  "mphantom",
  "menclose",
  "semantics",
]);
const MATH_ATTRS = new Set([
  "mathvariant",
  "display",
  "stretchy",
  "fence",
  "separator",
  "lspace",
  "rspace",
  "linethickness",
  "accent",
  "accentunder",
  "columnalign",
  "rowalign",
  "displaystyle",
  "scriptlevel",
  "width",
  "height",
  "depth",
]);

/** SVG elements and attributes kept inside verbatim markup (KaTeX draws roots, arrows and wide accents with them). */
const VERBATIM_SVG_TAGS = new Set(["svg", "g", "path", "line", "rect", "circle", "ellipse", "polyline", "polygon"]);
const VERBATIM_SVG_ATTRS = new Set([
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "points",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "fill-rule",
]);

function styleAttr(style: CSSMap): string {
  let s = "";
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || v === "") continue;
    s += `${k}:${v};`;
  }
  return s ? ` style="${escapeAttr(s)}"` : "";
}

function push(s: Ser, chunk: string): void {
  s.size += chunk.length;
  s.html.push(chunk);
}

function collapseMode(ws: string): "collapse" | "pre-line" | "preserve" {
  if (ws === "pre" || ws === "pre-wrap" || ws === "break-spaces") return "preserve";
  if (ws === "pre-line") return "pre-line";
  return "collapse";
}

/** Appends text as it renders: white-space runs collapse unless the white-space mode keeps them. */
function addText(s: Ser, raw: string, ws: string): void {
  const mode = collapseMode(ws);
  if (mode === "preserve") {
    s.text.push(raw);
    s.preserved = true;
    s.pendingSpace = false;
    return;
  }
  let t =
    mode === "pre-line"
      ? raw.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t\f\r]+/g, " ")
      : raw.replace(/[ \t\n\f\r]+/g, " ");
  if (s.pendingSpace && t.startsWith(" ")) t = t.slice(1);
  if (t.length === 0) return;
  s.text.push(t);
  s.pendingSpace = t.endsWith(" ") || t.endsWith("\n");
}

function lineBreak(s: Ser): void {
  s.text.push("\n");
  s.pendingSpace = true;
}

/** Inline style for an element inside a text block relative to its parent's text properties. */
function inlineStyle(info: ElInfo, parentProps: TextProps, own: TextProps, base: string): CSSMap {
  const style: CSSMap = {};
  diffTextStyle(parentProps, own, style);
  inlineBoxStyle(info.cs, base, style);
  if (info.opacity < 1) style.opacity = String(info.opacity);
  const d = info.display;
  if (d.startsWith("inline-") || isFlexOrGrid(d)) {
    if (isFlexOrGrid(d)) {
      flexLayoutStyle(info.cs, style);
      style.display = d.includes("grid") ? "inline-grid" : "inline-flex";
    } else {
      style.display = "inline-block";
    }
    const align = own["text-align"];
    if (align && align !== parentProps["text-align"]) style["text-align"] = align;
    const v = visualOf(info);
    if (paintsBox(v) || v.anySide) {
      const r = rectOf(info);
      style["box-sizing"] = "border-box";
      style.width = `${round(r.width)}px`;
      style.height = `${round(r.height)}px`;
    }
  } else if (d === "block" || d === "list-item") {
    style.display = "block";
  }
  return style;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function writeImg(s: Ser, info: ElInfo): void {
  const el = info.el;
  const r = rectOf(info);
  const cs = info.cs;
  const style: CSSMap = {
    width: `${round(r.width)}px`,
    height: `${round(r.height)}px`,
    "vertical-align": cs.verticalAlign || "baseline",
  };
  const fit = cs.getPropertyValue("object-fit");
  if (fit && fit !== "fill") style["object-fit"] = fit;
  const radius = cs.borderRadius;
  if (radius && radius !== "0px") style["border-radius"] = radius;
  for (const side of ["top", "right", "bottom", "left"]) {
    const m = cs.getPropertyValue(`margin-${side}`);
    if (m && m !== "0px") style[`margin-${side}`] = m;
  }
  if (info.opacity < 1) style.opacity = String(info.opacity);
  const src = imageUrlOf(el, s.base);
  if (!src) {
    style.display = "inline-block";
    push(s, `<span${styleAttr(style)}></span>`);
    return;
  }
  const alt = el.getAttribute("alt") ?? "";
  push(s, `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${styleAttr(style)}>`);
}

function writeSvg(s: Ser, info: ElInfo): void {
  const r = rectOf(info);
  const cs = info.cs;
  const style: CSSMap = {
    width: `${round(r.width)}px`,
    height: `${round(r.height)}px`,
    "vertical-align": cs.verticalAlign || "baseline",
  };
  for (const side of ["top", "right", "bottom", "left"]) {
    const m = cs.getPropertyValue(`margin-${side}`);
    if (m && m !== "0px") style[`margin-${side}`] = m;
  }
  if (info.opacity < 1) style.opacity = String(info.opacity);
  const svg = serializeSvg(info.el, {
    width: r.width,
    height: r.height,
    prefix: `sl${++s.cap.svgSeq}-`,
    base: s.base,
  });
  if (!svg) {
    style.display = "inline-block";
    push(s, `<span${styleAttr(style)}></span>`);
    return;
  }
  const label = info.el.getAttribute("aria-label") ?? "";
  push(s, `<img src="${escapeAttr(svgDataUrl(svg.markup))}" alt="${escapeAttr(label)}"${styleAttr(style)}>`);
}

function writeMath(s: Ser, el: Element, depth: number): void {
  if (depth > 48 || s.size > HTML_BUDGET) return;
  const tag = el.localName;
  if (el.namespaceURI !== MATHML_NS || !MATH_TAGS.has(tag)) return;
  let attrs = tag === "math" ? ` xmlns="${MATHML_NS}"` : "";
  for (const attr of Array.from(el.attributes)) {
    if (MATH_ATTRS.has(attr.name)) attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`;
  }
  push(s, `<${tag}${attrs}>`);
  for (const child of Array.from(el.childNodes)) {
    if (isText(child)) {
      push(s, escapeText(child.data));
      addText(s, child.data, "normal");
    } else if (isElement(child)) {
      writeMath(s, child, depth + 1);
    }
  }
  push(s, `</${tag}>`);
}

/**
 * Copies a verbatim subtree: HTML elements become spans with their class and inline style, SVG
 * keeps its geometry. Inline styles that load resources are dropped. `rootStyle` is appended to
 * the root's own style.
 */
function writeVerbatim(s: Ser, el: Element, depth: number, rootStyle = ""): void {
  if (depth > 64 || s.size > HTML_BUDGET) return;
  const svg = isSvgElement(el);
  if (svg ? !VERBATIM_SVG_TAGS.has(el.localName) : !isHtmlElement(el) || SKIP_TAGS.has(el.localName)) return;
  if (el.hasAttribute(IGNORE_ATTR) || infoOf(s.cap, el).display === "none") return;
  const tag = svg ? el.localName : "span";
  let attrs = tag === "svg" ? ` xmlns="${SVG_NS}"` : "";
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === "class" || (svg && VERBATIM_SVG_ATTRS.has(attr.name))) {
      attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`;
    }
  }
  const own = (el.getAttribute("style") ?? "").trim();
  const style = (own && !/(?:url|image-set)\s*\(/i.test(own) ? own.replace(/;?$/, ";") : "") + rootStyle;
  if (style) attrs += ` style="${escapeAttr(style)}"`;
  push(s, `<${tag}${attrs}>`);
  for (const child of Array.from(el.childNodes)) {
    if (isText(child)) {
      push(s, escapeText(child.data));
      if (!svg) addText(s, child.data, "normal");
    } else if (isElement(child)) {
      writeVerbatim(s, child, depth + 1);
    }
  }
  push(s, `</${tag}>`);
}

function writePseudo(s: Ser, info: ElInfo, which: "before" | "after", parentProps: TextProps): void {
  const p = pseudoOf(s.cap, info, which);
  if (!p || !isInlinePseudo(p)) return;
  const v = readBoxVisual(p.cs);
  const visibleText = hasVisibleText(p.text);
  if (!visibleText && !p.image && !paintsBox(v) && !v.anySide) return;
  const own = readTextProps(p.cs, s.cap.families);
  const style: CSSMap = {};
  diffTextStyle(parentProps, own, style);
  inlineBoxStyle(p.cs, s.base, style);
  const d = p.display;
  if (d.startsWith("inline-") || d === "block" || isFlexOrGrid(d)) {
    style.display = d === "block" ? "block" : "inline-block";
    const w = p.cs.width;
    const h = p.cs.height;
    if (w.endsWith("px")) style.width = w;
    if (h.endsWith("px")) style.height = h;
    if (w.endsWith("px") || h.endsWith("px")) style["box-sizing"] = p.cs.boxSizing || "content-box";
  }
  const opacity = Number.parseFloat(p.cs.opacity);
  if (Number.isFinite(opacity) && opacity < 1) style.opacity = String(opacity);
  let inner = escapeText(p.text);
  if (p.image) {
    const src = safeImageUrl(p.image, s.base);
    if (src) inner = `<img src="${escapeAttr(src)}" alt="" style="vertical-align:middle">${inner}`;
  }
  push(s, `<span${styleAttr(style)}>${inner}</span>`);
  if (visibleText) addText(s, p.text, own["white-space"] ?? "normal");
}

function writeElement(s: Ser, info: ElInfo, parentProps: TextProps, depth: number): void {
  const el = info.el;
  const tag = el.localName;
  if (info.visibility !== "visible") return;
  if (tag === "br") {
    push(s, "<br>");
    lineBreak(s);
    return;
  }
  if (tag === "wbr") {
    push(s, "<wbr>");
    return;
  }
  if (tag === "img") {
    writeImg(s, info);
    return;
  }
  if (tag === "svg") {
    writeSvg(s, info);
    return;
  }
  if (isMath(el)) {
    writeMath(s, el, 0);
    return;
  }
  if (isVerbatim(el)) {
    writeVerbatim(s, el, 0);
    return;
  }
  if (tag === "picture" || tag === "video" || tag === "canvas" || tag === "iframe") return;
  const own = textPropsOf(s.cap, info);
  const style = inlineStyle(info, parentProps, own, s.base);
  let open = "<span";
  let close = "</span>";
  if (tag === "a") {
    const href = el.getAttribute("href");
    const safe = href ? safeLinkUrl(href, s.base) : null;
    if (safe) {
      open = `<a href="${escapeAttr(safe)}"`;
      close = "</a>";
      // The stage's user-agent link styles must not leak in.
      style.color = own.color ?? "inherit";
      if (!style["text-decoration"]) style["text-decoration"] = "none";
    }
  } else if (KEEP_TAGS.has(tag)) {
    open = `<${tag}`;
    close = `</${tag}>`;
  }
  push(s, `${open}${styleAttr(style)}>`);
  writeContent(s, info, own, depth + 1);
  push(s, close);
}

/** Writes the flat children (and inline pseudo-elements) of `info`. */
function writeContent(s: Ser, info: ElInfo, props: TextProps, depth: number): void {
  writePseudo(s, info, "before", props);
  writeChildren(s, info, childrenOf(s.cap, info), props, depth);
  writePseudo(s, info, "after", props);
}

function writeChildren(s: Ser, info: ElInfo, children: readonly FlatChild[], props: TextProps, depth: number): void {
  for (const child of children) {
    if (s.size > HTML_BUDGET || depth > 64) return;
    const node = child.node;
    if (isText(node)) {
      writeText(s, info, child, node, props);
      continue;
    }
    if (!isElement(node)) continue;
    const cls = classify(s.cap, child, info);
    if (cls === "outflow") {
      s.outflow.push(node);
      continue;
    }
    if (cls !== "inline") continue;
    writeElement(s, infoOf(s.cap, node), props, depth);
  }
}

function writeText(s: Ser, host: ElInfo, child: FlatChild, node: Text, props: TextProps): void {
  const sp = child.styleParent === host.el ? host : infoOf(s.cap, child.styleParent);
  if (sp.visibility !== "visible") return;
  const data = node.data;
  const own = sp === host ? props : textPropsOf(s.cap, sp);
  if (!s.firstText && hasVisibleText(data)) s.firstText = node;
  if (own === props) {
    push(s, escapeText(data));
  } else {
    const style: CSSMap = {};
    diffTextStyle(props, own, style);
    push(s, Object.keys(style).length > 0 ? `<span${styleAttr(style)}>${escapeText(data)}</span>` : escapeText(data));
  }
  addText(s, data, own["white-space"] ?? "normal");
}

export interface SerializeOptions {
  /** Serialise only these children (a run of mixed content) and skip the host's pseudo-elements. */
  children?: readonly FlatChild[];
  /** Include ::before (default true when serialising all children). */
  before?: boolean;
  after?: boolean;
}

function newSer(cap: Capture, el: Element): Ser {
  return {
    cap,
    base: el.baseURI || cap.doc.baseURI,
    html: [],
    text: [],
    outflow: [],
    size: 0,
    pendingSpace: true,
    preserved: false,
    firstText: null,
  };
}

/** Serialises the inline content of `info` (or a run of its children) into sanitised HTML + plain text. */
export function serializeInline(cap: Capture, info: ElInfo, opts: SerializeOptions = {}): Fragment {
  const s = newSer(cap, info.el);
  const props = textPropsOf(cap, info);
  const all = opts.children === undefined;
  if (opts.before ?? all) writePseudo(s, info, "before", props);
  writeChildren(s, info, opts.children ?? childrenOf(cap, info), props, 0);
  if (opts.after ?? all) writePseudo(s, info, "after", props);
  return { html: s.html.join(""), text: finishText(s), outflow: s.outflow, firstText: s.firstText };
}

function finishText(s: Ser): string {
  let t = s.text.join("");
  if (s.preserved) return t.replace(/^\n/, "").replace(/\s+$/, "");
  t = t.replace(/ *\n */g, "\n");
  return t.trim();
}

/** Serialises a display-math element (allow-listed MathML only). */
export function serializeMath(cap: Capture, el: Element): Fragment {
  const s = newSer(cap, el);
  writeMath(s, el, 0);
  return { html: s.html.join(""), text: finishText(s), outflow: [], firstText: null };
}

/** Serialises a block-level verbatim element as itself, without margins (the layer box is its border box). */
export function serializeVerbatim(cap: Capture, el: Element): Fragment {
  const s = newSer(cap, el);
  writeVerbatim(s, el, 0, "margin:0;");
  return { html: s.html.join(""), text: finishText(s), outflow: [], firstText: null };
}
