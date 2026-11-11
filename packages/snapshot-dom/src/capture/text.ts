import type { CSSMap, LayerRole, Rect, TextLayer } from "@swarmloom/core";
import { isElement, isText } from "../dom/env";
import { px } from "../util/css";
import { union } from "../util/geom";
import { isFlexOrGrid } from "./inline";
import { type FirstLine, firstLineOf } from "./metrics";
import type { Placement } from "./place";
import { type RunNeighbours, runSpacers, spacerHtml } from "./run-spacers";
import { type Fragment, type SerializeOptions, serializeInline } from "./serialize";
import {
  type Capture,
  type Ctx,
  type ElInfo,
  emit,
  type FlatChild,
  type FloatRec,
  infoOf,
  rectOf,
  toWorld,
} from "./state";
import { containerTextStyle, flexLayoutStyle, safeCssImages, textPropsOf, visualOf } from "./styles";

const ROLE_BY_TAG: Readonly<Record<string, LayerRole>> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  p: "paragraph",
  li: "list-item",
  dt: "list-item",
  dd: "list-item",
  blockquote: "quote",
  pre: "code",
  code: "code",
  td: "cell",
  th: "cell",
  button: "button",
  figcaption: "figure",
  caption: "table",
};

/** Semantic role of a text block from its element and nearby ancestors. */
export function textRole(el: Element, fontSize: number): LayerRole | undefined {
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 3; depth++) {
    const aria = cur.getAttribute("role");
    if (aria === "heading" || aria === "button" || aria === "cell" || aria === "listitem" || aria === "math") {
      return aria === "listitem" ? "list-item" : aria;
    }
    const role = ROLE_BY_TAG[cur.localName];
    if (role) return role;
    cur = cur.parentElement;
  }
  return fontSize >= 28 ? "heading" : undefined;
}

function floatPlaceholders(box: Rect, floats: readonly FloatRec[]): string {
  let html = "";
  for (const f of floats) {
    const fb = f.box;
    if (fb.y >= box.y + box.h || fb.y + fb.h <= box.y) continue;
    if (fb.x >= box.x + box.w || fb.x + fb.w <= box.x) continue;
    const w = f.side === "left" ? fb.x + fb.w - box.x : box.x + box.w - fb.x;
    const offset = Math.max(0, fb.y - box.y);
    const h = fb.y + fb.h - box.y - offset;
    if (w <= 0 || h <= 0 || w >= box.w - 8) continue;
    if (offset > 0.5) html += `<span style="float:${f.side};clear:${f.side};width:0;height:${round(offset)}px"></span>`;
    html += `<span style="float:${f.side};clear:${f.side};width:${round(w)}px;height:${round(h)}px"></span>`;
  }
  return html;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** World margin box of a floating element. */
export function floatBox(cap: Capture, ctx: Ctx, info: ElInfo): FloatRec | null {
  const side = info.float === "right" || info.float === "inline-end" ? "right" : info.float === "none" ? null : "left";
  if (!side) return null;
  const r = toWorld(cap, ctx, rectOf(info));
  const cs = info.cs;
  const box = {
    x: r.x - px(cs.marginLeft),
    y: r.y - px(cs.marginTop),
    w: r.w + px(cs.marginLeft) + px(cs.marginRight),
    h: r.h + px(cs.marginTop) + px(cs.marginBottom),
  };
  return box.w > 0 && box.h > 0 ? { box, side } : null;
}

function localFloats(cap: Capture, ctx: Ctx, outflow: readonly Element[]): FloatRec[] {
  const out: FloatRec[] = [];
  for (const el of outflow) {
    const info = infoOf(cap, el);
    if (info.position === "absolute" || info.position === "fixed") continue;
    const f = floatBox(cap, ctx, info);
    if (f) out.push(f);
  }
  return out;
}

/** Ordinal of a list item inside an ordered list (honours start, value and reversed). */
function listOrdinal(li: Element): number | null {
  const list = li.parentElement;
  if (list?.localName !== "ol") return null;
  const items = Array.from(list.children).filter((c) => c.localName === "li");
  const reversed = list.hasAttribute("reversed");
  const startAttr = Number.parseInt(list.getAttribute("start") ?? "", 10);
  let n = Number.isFinite(startAttr) ? startAttr : reversed ? items.length : 1;
  for (const item of items) {
    const value = Number.parseInt(item.getAttribute("value") ?? "", 10);
    if (Number.isFinite(value)) n = value;
    if (item === li) return n;
    n += reversed ? -1 : 1;
  }
  return null;
}

/** Container style of a text block: text properties plus block-level presentation of the host. */
function blockTextStyle(cap: Capture, info: ElInfo, asLeaf: boolean): CSSMap {
  const cs = info.cs;
  const style = containerTextStyle(textPropsOf(cap, info));
  if (!asLeaf) return style;
  if (isFlexOrGrid(info.display)) flexLayoutStyle(cs, style);
  const clamp = cs.getPropertyValue("-webkit-line-clamp");
  if (clamp && clamp !== "none" && info.display.includes("box")) {
    style.display = "-webkit-box";
    style["-webkit-box-orient"] = "vertical";
    style["-webkit-line-clamp"] = clamp;
    style.overflow = "hidden";
  } else if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
    style.overflow = "hidden";
    const ellipsis = cs.getPropertyValue("text-overflow");
    if (ellipsis && ellipsis !== "clip") style["text-overflow"] = ellipsis;
  }
  if (info.display === "list-item") {
    const type = cs.getPropertyValue("list-style-type");
    const image = cs.getPropertyValue("list-style-image");
    if ((type && type !== "none") || (image && image !== "none")) {
      style.display = "list-item";
      style["list-style-type"] = type || "disc";
      style["list-style-position"] = cs.getPropertyValue("list-style-position") || "outside";
      if (image && image !== "none") style["list-style-image"] = safeCssImages(image, info.el.baseURI);
      const n = listOrdinal(info.el);
      if (n !== null) style["counter-set"] = `list-item ${n}`;
    }
  }
  const v = visualOf(info);
  if (v.textClip) {
    const img = cs.backgroundImage;
    if (img && img !== "none") style["background-image"] = safeCssImages(img, info.el.baseURI);
    for (const p of ["background-size", "background-position", "background-repeat"]) {
      const value = cs.getPropertyValue(p);
      if (value) style[p] = value;
    }
    style["background-clip"] = "text";
    style["-webkit-background-clip"] = "text";
  }
  return style;
}

/** Vertical alignment the host applies to its content that a plain block would lose. */
function verticalAlignment(info: ElInfo): string | null {
  const d = info.display;
  if (d === "table-cell") {
    const va = info.cs.verticalAlign;
    return va === "middle" ? "center" : va === "bottom" ? "flex-end" : null;
  }
  if (info.el.localName === "button" && !isFlexOrGrid(d)) return "center";
  return null;
}

export interface TextResult {
  id: string | null;
  outflow: Element[];
}

/**
 * Emits the whole inline content of a leaf element as one text layer placed at its content box.
 * Returns the out-of-flow descendants that still need visiting.
 */
export function emitTextLeaf(cap: Capture, ctx: Ctx, info: ElInfo, content: Placement): TextResult {
  const frag = serializeInline(cap, info);
  if (!frag.text) return { id: null, outflow: frag.outflow };
  const style = blockTextStyle(cap, info, true);
  let html = frag.html;
  const align = verticalAlignment(info);
  if (align && !style.display) {
    style.display = "flex";
    style["flex-direction"] = "column";
    style["justify-content"] = align;
    html = `<div>${html}</div>`;
  }
  const floats = [...cap.floats, ...localFloats(cap, ctx, frag.outflow)];
  if (floats.length > 0 && !content.transform) html = floatPlaceholders(content.box, floats) + html;
  const id = emitText(cap, ctx, info, frag, html, style, content);
  return { id, outflow: frag.outflow };
}

/**
 * Emits a run of inline children of a mixed-content container (text between block children).
 * Horizontally the run spans the container's content box; vertically it covers its line boxes.
 * `neighbours` are the children emitted on their own right before and after the run: inline atoms
 * among them that share the run's first or last line get a spacer so the text keeps its position.
 */
export function emitTextRun(
  cap: Capture,
  ctx: Ctx,
  info: ElInfo,
  children: readonly FlatChild[],
  content: Rect,
  opts: Pick<SerializeOptions, "before" | "after">,
  neighbours: RunNeighbours = {},
): TextResult {
  const frag = serializeInline(cap, info, { children, ...opts });
  if (!frag.text) return { id: null, outflow: frag.outflow };
  let bounds: Rect | null = null;
  for (const child of children) {
    const b = childBounds(cap, ctx, child);
    if (b) bounds = union(bounds, b);
  }
  if (!bounds) return { id: null, outflow: frag.outflow };
  const line = firstLineOf(cap, frag.firstText);
  const props = textPropsOf(cap, info);
  const fs = px(props["font-size"], 16);
  const lh = props["line-height"] === "normal" ? fs * 1.2 : px(props["line-height"], fs * 1.2);
  const lead = Math.max(0, (lh - (line ? line.contentHeight : fs * 1.15)) / 2);
  const y = bounds.y - lead;
  // In flex/grid containers a text run is an anonymous item with its own box; in block flow it
  // spans the container's content box so alignment and wrapping match.
  const item = isFlexOrGrid(info.display);
  const box = item
    ? { x: bounds.x, y, w: bounds.w + 1, h: bounds.y + bounds.h + lead - y }
    : { x: content.x, y, w: content.w, h: bounds.y + bounds.h + lead - y };
  const style = blockTextStyle(cap, info, false);
  if (item) {
    if (bounds.h <= lh * 1.5) style["white-space"] = "nowrap";
    delete style["text-align"];
    delete style["text-indent"];
  }
  let body = frag.html;
  if (!item && !ctx.linear) {
    const left = content.x - ctx.dx;
    const spacers = runSpacers(cap, info, children, neighbours, { left, right: left + content.w });
    if (spacers.lead > 0) {
      body = spacerHtml(spacers.lead) + body;
      // The spacer already covers everything before the text on its first line.
      delete style["text-indent"];
    }
    if (spacers.trail > 0) body += spacerHtml(spacers.trail);
  }
  const floats = [...cap.floats, ...localFloats(cap, ctx, frag.outflow)];
  const html = (floats.length > 0 ? floatPlaceholders(box, floats) : "") + body;
  const id = emitText(cap, ctx, info, frag, html, style, { box }, line);
  return { id, outflow: frag.outflow };
}

function childBounds(cap: Capture, ctx: Ctx, child: FlatChild): Rect | null {
  const node = child.node;
  if (isText(node)) {
    if (!/\S/.test(node.data)) return null;
    cap.range.selectNodeContents(node);
    const r = cap.range.getBoundingClientRect();
    return r.width > 0 || r.height > 0 ? toWorld(cap, ctx, r) : null;
  }
  if (isElement(node)) {
    const info = infoOf(cap, node);
    if (info.position === "absolute" || info.position === "fixed" || (info.float !== "none" && info.float !== ""))
      return null;
    const r = rectOf(info);
    return r.width > 0 || r.height > 0 ? toWorld(cap, ctx, r) : null;
  }
  return null;
}

function emitText(
  cap: Capture,
  ctx: Ctx,
  info: ElInfo,
  frag: Fragment,
  html: string,
  style: CSSMap,
  place: Placement,
  known?: FirstLine | null,
): string | null {
  const fontSize = Math.round(px(textPropsOf(cap, info)["font-size"], 16) * 100) / 100;
  const draft: Omit<TextLayer, "id"> = { kind: "text", box: place.box, html, text: frag.text, style, fontSize };
  const role = textRole(info.el, fontSize);
  if (role) draft.role = role;
  if (place.transform) draft.transform = place.transform;
  const id = emit<TextLayer>(cap, ctx, draft);
  if (id && !place.transform) {
    const line = known === undefined ? firstLineOf(cap, frag.firstText) : known;
    if (line) {
      const y = toWorld(cap, ctx, { left: 0, top: line.baseline, width: 0, height: 0 }).y;
      cap.baselines.set(id, Math.round(y * 100) / 100);
    }
  }
  return id;
}
