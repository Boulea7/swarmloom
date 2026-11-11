import type { BoxLayer, Rect, TextLayer } from "@swarmloom/core";
import { FORM_TAGS, IGNORE_ATTR, isElement, isText, MEDIA_ATTR, MEDIA_TAGS, SKIP_TAGS } from "../dom/env";
import { throwIfAborted } from "../util/abort";
import { px } from "../util/css";
import { inset, intersect, isIdentity, multiplyLinear, parseLinear } from "../util/geom";
import { emitBox, emitRule, emitSides } from "./box";
import { emitFormControl } from "./form";
import { classify, hasVisibleText, inlineFacts, isFlexOrGrid, isMath, isTextLeaf, isVerbatim } from "./inline";
import { emitMedia } from "./media";
import { type Placement, placeElement, placeInset } from "./place";
import { emitPositionedPseudo } from "./pseudo";
import { serializeMath, serializeVerbatim } from "./serialize";
import {
  type Capture,
  type Ctx,
  childrenOf,
  closeNode,
  type ElInfo,
  emit,
  type FlatChild,
  infoOf,
  openNode,
  rectOf,
  toWorld,
} from "./state";
import { borderInsets, containerTextStyle, contentInsets, paintsBox, textPropsOf, visualOf } from "./styles";
import { emitTextLeaf, emitTextRun, floatBox, textRole } from "./text";
import { emitBackdrop, isTopLayer, TOP_LAYER_KEY } from "./top-layer";

/** Initial walk context: viewport -> world offset (dx, dy) and an optional world clip. */
export function rootContext(dx: number, dy: number, clip: Rect | null): Ctx {
  return {
    dx,
    dy,
    clip,
    absClip: clip,
    fixedClip: clip,
    opacity: 1,
    linear: null,
    paintKey: [1],
    stackKey: [],
    parentId: undefined,
    parentIsFlexOrGrid: false,
    outsideShell: true,
    inFixed: false,
    fixedContainer: false,
    frameDepth: 0,
    frameX: 0,
    frameY: 0,
  };
}

function clipsOverflow(cs: CSSStyleDeclaration): boolean {
  return cs.overflowX !== "visible" || cs.overflowY !== "visible";
}

function isScrollContainer(cs: CSSStyleDeclaration): boolean {
  const o = cs.overflowY;
  return o === "auto" || o === "scroll" || o === "hidden" || o === "overlay";
}

/** Visually hidden (screen-reader only) content. */
function isSrOnly(info: ElInfo): boolean {
  if (info.position !== "absolute" && info.position !== "fixed") return false;
  const r = rectOf(info);
  if (r.width <= 1.5 && r.height <= 1.5) return true;
  const clip = info.cs.getPropertyValue("clip");
  if (clip && /^rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)$/.test(clip)) return true;
  return info.cs.getPropertyValue("clip-path") === "inset(50%)";
}

function hasPaintContainment(cs: CSSStyleDeclaration): boolean {
  const contain = cs.getPropertyValue("contain");
  return /\b(?:paint|layout|strict|content)\b/.test(contain);
}

/** The element is the containing block of fixed-position descendants. */
function containsFixed(info: ElInfo): boolean {
  if (info.fixedCb === undefined) info.fixedCb = readContainsFixed(info.cs);
  return info.fixedCb;
}

function readContainsFixed(cs: CSSStyleDeclaration): boolean {
  if (cs.transform !== "none" || cs.filter !== "none") return true;
  const perspective = cs.getPropertyValue("perspective");
  if (perspective && perspective !== "none") return true;
  const backdrop = cs.getPropertyValue("backdrop-filter") || cs.getPropertyValue("-webkit-backdrop-filter");
  if (backdrop && backdrop !== "none") return true;
  if (hasPaintContainment(cs)) return true;
  return /\b(?:transform|filter|perspective)\b/.test(cs.getPropertyValue("will-change"));
}

function createsStackingContext(info: ElInfo, parentIsFlexOrGrid: boolean): boolean {
  const cs = info.cs;
  if (cs.zIndex !== "auto" && (info.position !== "static" || parentIsFlexOrGrid)) return true;
  if (info.position === "fixed" || info.position === "sticky") return true;
  if (info.opacity < 1 || containsFixed(info)) return true;
  if ((cs.getPropertyValue("mix-blend-mode") || "normal") !== "normal") return true;
  if (cs.getPropertyValue("isolation") === "isolate") return true;
  const clipPath = cs.getPropertyValue("clip-path");
  if (clipPath && clipPath !== "none") return true;
  const mask = cs.getPropertyValue("mask-image") || cs.getPropertyValue("-webkit-mask-image");
  if (mask && mask !== "none") return true;
  return /\b(?:opacity|z-index)\b/.test(cs.getPropertyValue("will-change"));
}

/** Viewport top/bottom of the scrollport a sticky element sticks to. */
function scrollportOf(cap: Capture, el: Element): { top: number; bottom: number } {
  let cur: Element | null = el.parentElement;
  for (let depth = 0; cur && depth < 64; depth++) {
    const info = infoOf(cap, cur);
    if (cur === cur.ownerDocument.documentElement || cur === cur.ownerDocument.body) break;
    if (isScrollContainer(info.cs)) {
      const r = rectOf(info);
      const top = r.top + px(info.cs.borderTopWidth);
      return { top, bottom: top + cur.clientHeight };
    }
    cur = cur.parentElement;
  }
  const view = el.ownerDocument.defaultView;
  return { top: 0, bottom: view ? view.innerHeight : 0 };
}

/** Estimated world top of a sticky element at its in-flow position. */
function naturalTop(cap: Capture, ctx: Ctx, info: ElInfo): number | null {
  const el = info.el;
  const parent = el.parentElement;
  if (!parent) return null;
  const pinfo = infoOf(cap, parent);
  const mt = px(info.cs.marginTop);
  const row = isFlexOrGrid(pinfo.display) && !pinfo.cs.flexDirection.startsWith("column");
  if (!row) {
    let prev = el.previousElementSibling;
    while (prev) {
      const pi = infoOf(cap, prev);
      if (
        pi.display !== "none" &&
        pi.position !== "absolute" &&
        pi.position !== "fixed" &&
        (pi.float === "none" || pi.float === "")
      ) {
        const pr = toWorld(cap, ctx, rectOf(pi));
        return pr.y + pr.h + Math.max(px(pi.cs.marginBottom), mt);
      }
      prev = prev.previousElementSibling;
    }
  }
  const pr = rectOf(pinfo);
  const scrolled = isScrollContainer(pinfo.cs) ? parent.scrollTop : 0;
  const top = pr.top + px(pinfo.cs.borderTopWidth) + px(pinfo.cs.paddingTop) - scrolled;
  return toWorld(cap, ctx, { left: 0, top, width: 0, height: 0 }).y + mt;
}

/** World offset that moves a stuck sticky element back to its in-flow position (0 when not stuck). */
function stickyShift(cap: Capture, ctx: Ctx, info: ElInfo): number {
  const cs = info.cs;
  const r = rectOf(info);
  const sp = scrollportOf(cap, info.el);
  const stuckTop = cs.top.endsWith("px") && Math.abs(r.top - (sp.top + px(cs.top))) < 1.5;
  const stuckBottom = !stuckTop && cs.bottom.endsWith("px") && Math.abs(r.bottom - (sp.bottom - px(cs.bottom))) < 1.5;
  if (!stuckTop && !stuckBottom) return 0;
  const natural = naturalTop(cap, ctx, info);
  if (natural === null) return 0;
  const shift = natural - toWorld(cap, ctx, r).y;
  if (stuckTop && shift > -0.5) return 0;
  if (stuckBottom && shift < 0.5) return 0;
  return shift;
}

/**
 * Context for the element's own layers: position scheme, opacity, sticky offset, transform, paint key.
 * `topLayer` elements (modal dialogs, popovers, fullscreen) ignore ancestor clips, containing blocks
 * and z-index, and paint above the whole page.
 */
function ownContext(cap: Capture, ctx: Ctx, info: ElInfo, index: number, topLayer: boolean): Ctx {
  const c: Ctx = { ...ctx, opacity: (topLayer ? 1 : ctx.opacity) * info.opacity };
  const pos = info.position;
  if (pos === "fixed") {
    c.clip = topLayer ? null : ctx.fixedClip;
    if (cap.mode === "document" && ctx.frameDepth === 0 && (topLayer || !ctx.fixedContainer)) {
      // Fixed headers/bars are captured once, where they sit with the page scrolled to the top.
      c.dx = 0;
      c.dy = 0;
      c.linear = null;
      c.outsideShell = true;
      c.inFixed = true;
    }
  } else if (pos === "absolute") {
    c.clip = ctx.absClip;
  } else if (pos === "sticky") {
    c.dy += stickyShift(cap, ctx, info);
  }
  const t = info.cs.transform;
  if (t && t !== "none") {
    const lin = parseLinear(t);
    if (lin && !isIdentity(lin)) c.linear = c.linear ? multiplyLinear(c.linear, lin) : lin;
  }
  if (topLayer) {
    c.paintKey = [TOP_LAYER_KEY, index];
    c.stackKey = c.paintKey;
  } else if (createsStackingContext(info, ctx.parentIsFlexOrGrid)) {
    const z = Number.parseInt(info.cs.zIndex, 10);
    const zi = Number.isFinite(z) && (pos !== "static" || ctx.parentIsFlexOrGrid) ? z : 0;
    c.paintKey = [...ctx.stackKey, zi < 0 ? 0 : zi === 0 ? 3 : 4, zi, index];
    c.stackKey = c.paintKey;
  } else if (pos !== "static") {
    c.paintKey = [...ctx.stackKey, 3, 0, index];
  }
  // The snapshot root paints below everything it contains, including negative z-index content.
  if (info.el === cap.root) c.paintKey = [];
  return c;
}

/** Context for the element's children: clips, containing blocks, shell unrolling. */
function childContext(
  cap: Capture,
  own: Ctx,
  info: ElInfo,
  place: Placement,
  boxId: string | null,
  newKey: boolean,
  topLayer: boolean,
): Ctx | null {
  const el = info.el;
  const kids: Ctx = {
    ...own,
    parentId: boxId ?? own.parentId,
    parentIsFlexOrGrid: isFlexOrGrid(info.display),
    // Content of a positioned element / stacking context paints above its own box.
    paintKey: newKey ? [...own.paintKey, 1] : own.paintKey,
  };
  const shell = cap.shell;
  const doc = el.ownerDocument;
  const isPageRoot = el === doc.documentElement || el === doc.body;
  if (shell && shell.el === el && !own.linear) {
    kids.dx = own.dx + el.scrollLeft;
    kids.dy = own.dy + el.scrollTop;
    kids.outsideShell = false;
    const pad = inset(place.box, ...borderInsets(info.cs));
    kids.clip = own.clip ? intersect(own.clip, pad) : pad;
    if (!kids.clip) return null;
  } else if (!isPageRoot && !own.linear && (clipsOverflow(info.cs) || hasPaintContainment(info.cs))) {
    const pad = clipsOverflow(info.cs) ? inset(place.box, ...borderInsets(info.cs)) : place.box;
    kids.clip = own.clip ? intersect(own.clip, pad) : pad;
    if (!kids.clip) return null;
  }
  const fixedCb = containsFixed(info) || topLayer;
  if (info.position !== "static" || fixedCb) kids.absClip = kids.clip;
  if (fixedCb) {
    kids.fixedClip = kids.clip;
    kids.fixedContainer = true;
  }
  return kids;
}

/** Walks one element subtree. */
export function visit(cap: Capture, el: Element, ctx: Ctx): void {
  if (cap.visited >= cap.maxElements) {
    cap.elementCapHit = true;
    return;
  }
  cap.visited++;
  if ((cap.visited & 127) === 0) throwIfAborted(cap.opts.signal);
  const tag = el.localName;
  if (SKIP_TAGS.has(tag) || el.hasAttribute(IGNORE_ATTR)) return;
  const info = infoOf(cap, el);
  if (info.display === "none" || info.opacity <= 0.001 || isSrOnly(info)) return;
  const topLayer = info.position === "fixed" && ctx.frameDepth === 0 && isTopLayer(el);
  const own = ownContext(cap, ctx, info, ++cap.treeIndex, topLayer);
  if (topLayer && cap.mode === "document") emitBackdrop(cap, own, el);
  const place = placeElement(cap, own, info);
  const rec = openNode(cap, el, place.box);
  try {
    render(cap, own, info, place, own.paintKey !== ctx.paintKey, topLayer);
  } finally {
    closeNode(cap, rec);
  }
}

function render(cap: Capture, own: Ctx, info: ElInfo, place: Placement, newKey: boolean, topLayer: boolean): void {
  const el = info.el;
  const tag = el.localName;
  const visible = info.visibility === "visible";
  if (el.hasAttribute(MEDIA_ATTR) || MEDIA_TAGS.has(tag)) {
    if (!visible) return;
    if ((tag === "iframe" || tag === "frame") && visitFrame(cap, own, info, place)) return;
    emitMedia(cap, own, info, place);
    return;
  }
  if (FORM_TAGS.has(tag)) {
    if (visible) emitFormControl(cap, own, info, place, visualOf(info));
    return;
  }
  if (isMath(el) || isVerbatim(el)) {
    if (visible) emitAtomBlock(cap, own, info, place);
    return;
  }
  const v = visualOf(info);
  let boxId: string | null = null;
  if (visible && !cap.bgSources.has(el)) {
    if (tag === "hr") {
      if (!emitRule(cap, own, info, place, v) && paintsBox(v)) emitBox(cap, own, info, place, v);
      return;
    }
    if (paintsBox(v)) boxId = emitBox(cap, own, info, place, v);
    else if (v.anySide) emitSides(cap, own, place, v);
  }
  if (info.float !== "none" && info.float !== "" && info.position !== "absolute" && info.position !== "fixed") {
    const f = floatBox(cap, own, info);
    if (f) cap.floats.push(f);
  }
  // content-visibility:hidden skips painting the contents (the element's own box still paints).
  if (info.cs.getPropertyValue("content-visibility") === "hidden") return;
  const kids = childContext(cap, own, info, place, boxId, newKey, topLayer);
  if (!kids) return;
  if (visible) emitPositionedPseudo(cap, kids, info, "before", place.box);
  renderContent(cap, kids, info);
  if (visible) emitPositionedPseudo(cap, kids, info, "after", place.box);
}

function renderContent(cap: Capture, kids: Ctx, info: ElInfo): void {
  if (isTextLeaf(cap, info)) {
    const content = placeInset(cap, kids, info, contentInsets(info.cs));
    const res = emitTextLeaf(cap, kids, info, content);
    for (const o of res.outflow) visit(cap, o, kids);
    return;
  }
  let content: Rect | null = null;
  const contentBox = (): Rect => {
    if (!content) content = placeInset(cap, kids, info, contentInsets(info.cs)).box;
    return content;
  };
  let seg: FlatChild[] = [];
  let segText = false;
  let sawBlock = false;
  let prevBlock: FlatChild | undefined;
  const flush = (atEnd: boolean, next?: FlatChild): void => {
    if (seg.length === 0) return;
    if (segText) {
      const neighbours = { prev: prevBlock, next };
      const res = emitTextRun(cap, kids, info, seg, contentBox(), { before: !sawBlock, after: atEnd }, neighbours);
      for (const o of res.outflow) visit(cap, o, kids);
    } else {
      for (const ch of seg) if (isElement(ch.node)) visit(cap, ch.node, kids);
    }
    seg = [];
    segText = false;
  };
  for (const child of childrenOf(cap, info)) {
    const cls = classify(cap, child, info);
    if (cls === "skip") continue;
    const node = child.node;
    if (cls === "outflow") {
      if (isElement(node)) visit(cap, node, kids);
      continue;
    }
    if (cls === "block") {
      flush(false, child);
      sawBlock = true;
      prevBlock = child;
      if (isElement(node)) visit(cap, node, kids);
      continue;
    }
    seg.push(child);
    if (!segText) {
      if (isText(node)) {
        segText = hasVisibleText(node.data) && infoOf(cap, child.styleParent).visibility === "visible";
      } else if (isElement(node)) {
        segText = inlineFacts(cap, infoOf(cap, node)).hasText;
      }
    }
  }
  flush(true);
}

/** A display-math or block-level verbatim element: one text layer holding the whole element. */
function emitAtomBlock(cap: Capture, own: Ctx, info: ElInfo, place: Placement): void {
  const math = isMath(info.el);
  const frag = math ? serializeMath(cap, info.el) : serializeVerbatim(cap, info.el);
  if (!frag.text) return;
  const style = containerTextStyle(textPropsOf(cap, info));
  if (math) style["text-align"] = "center";
  const fontSize = Math.round(px(info.cs.fontSize, 16) * 100) / 100;
  const role = math ? "math" : textRole(info.el, fontSize);
  const draft: Omit<TextLayer, "id"> = {
    kind: "text",
    box: place.box,
    html: frag.html,
    text: frag.text,
    style,
    fontSize,
    ...(role ? { role } : {}),
  };
  if (place.transform) draft.transform = place.transform;
  emit<TextLayer>(cap, own, draft);
}

/** Background colour/image of a frame document (html, else body). */
function frameBackground(cap: Capture, doc: Document): string | null {
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    const v = visualOf(infoOf(cap, el));
    if (v.fill || v.image) return infoOf(cap, el).cs.backgroundColor;
  }
  return null;
}

/** Captures a same-origin iframe document in place. Returns false when it must become a placeholder. */
function visitFrame(cap: Capture, own: Ctx, info: ElInfo, place: Placement): boolean {
  if (own.frameDepth >= 3 || own.linear) return false;
  let doc: Document | null = null;
  try {
    doc = (info.el as HTMLIFrameElement).contentDocument;
  } catch {
    doc = null;
  }
  const root = doc?.documentElement;
  const body = doc?.body;
  if (!doc || !root || !doc.defaultView) return false;
  if (body && body.childElementCount === 0 && !(body.textContent ?? "").trim()) return false;
  const v = visualOf(info);
  const boxId = paintsBox(v) ? emitBox(cap, own, info, place, v) : null;
  const insets = contentInsets(info.cs);
  const content = placeInset(cap, own, info, insets).box;
  const clip = own.clip ? intersect(own.clip, content) : content;
  if (!clip) return true;
  const r = rectOf(info);
  const frameKey = [...own.paintKey, 1];
  const fctx: Ctx = {
    ...own,
    dx: content.x,
    dy: content.y,
    clip,
    absClip: clip,
    fixedClip: clip,
    linear: null,
    paintKey: [...frameKey, 1],
    stackKey: frameKey,
    parentId: boxId ?? own.parentId,
    parentIsFlexOrGrid: false,
    outsideShell: false,
    fixedContainer: true,
    frameDepth: own.frameDepth + 1,
    frameX: own.frameX + r.left + insets[3],
    frameY: own.frameY + r.top + insets[0],
  };
  const bg = frameBackground(cap, doc);
  let bgId: string | null = null;
  if (bg)
    bgId = emit<BoxLayer>(
      cap,
      { ...fctx, paintKey: frameKey },
      { kind: "box", box: content, style: { background: bg } },
    );
  cap.bgSources.add(root);
  if (body) cap.bgSources.add(body);
  visit(cap, root, { ...fctx, parentId: bgId ?? fctx.parentId });
  return true;
}
