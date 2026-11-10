import type { ImageLayer, Layer, PathLayer, PathReveal, Rect, Size } from "@swarmloom/core";
import { DefsBuilder, type RefContext } from "./defs";
import { elementSegments, SHAPE_TAGS } from "./dom-shapes";
import { extractAnchors, type PenAnchor } from "./path/anchors";
import {
  determinant,
  formatNumber,
  fromDomMatrix,
  isFiniteMatrix,
  type Matrix,
  meanScale,
  multiply,
  pathBounds,
  placeRect,
  serializePath,
  transformRect,
  transformSegments,
} from "./path/geometry";
import { maskValue } from "./raw";
import { computedStyle, num } from "./style";
import { convertText, type TextDraft } from "./text";
import { normalizedDiagonal, SVG_NS, XLINK_NS } from "./units";
import { KEY_ATTR } from "./use";

export interface ConvertOptions {
  /** World size (stage px); layers are clipped to it. */
  world: Size;
  /** Maps client coordinates to stage coordinates. */
  clientToStage: Matrix;
  /** Maximum number of content layers (the defs layer is not counted). */
  maxLayers: number;
  /** Maximum pen anchors kept per path in `meta.anchors`. */
  anchorsPerPath: number;
  /** Prefix for generated definition ids. */
  idPrefix: string;
  signal?: AbortSignal;
}

export interface ConvertResult {
  layers: Layer[];
  /** Renderable elements left out because of `maxLayers`. */
  dropped: number;
  defs: DefsBuilder;
}

/** Inherited state while walking groups. */
interface Frame {
  opacity: number;
  clip: string | null;
  mask: string | null;
  filter: string | null;
  /** Stage-space clip of enclosing nested `<svg>` viewports. */
  viewport: Rect | null;
}

const NON_RENDERED = new Set([
  "defs",
  "symbol",
  "clipPath",
  "mask",
  "marker",
  "pattern",
  "linearGradient",
  "radialGradient",
  "filter",
  "style",
  "title",
  "desc",
  "metadata",
  "use",
  "stop",
]);
const GROUPS = new Set(["g", "a", "switch", "svg"]);
const MARKER_PROPS = ["marker-start", "marker-mid", "marker-end"] as const;
const MARKABLE = new Set(["path", "line", "polyline", "polygon"]);
/** Shapes smaller than this (w + h, stage px) fade in instead of being drawn. */
const TINY = 6;

type Draft = Omit<PathLayer, "id"> | Omit<ImageLayer, "id"> | TextDraft;

function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.w <= outer.x + outer.w + 0.5 &&
    inner.y + inner.h <= outer.y + outer.h + 0.5
  );
}

function roundRect(r: Rect): Rect {
  const x = Math.round(r.x * 100) / 100;
  const y = Math.round(r.y * 100) / 100;
  return { x, y, w: Math.round(r.w * 100) / 100, h: Math.round(r.h * 100) / 100 };
}

function compactAnchors(anchors: PenAnchor[]): PenAnchor[] {
  const r = (v: number): number => Math.round(v * 10) / 10;
  return anchors.map((a) => {
    const out: PenAnchor = { x: r(a.x), y: r(a.y) };
    if (a.in) out.in = { x: r(a.in.x), y: r(a.in.y) };
    if (a.out) out.out = { x: r(a.out.x), y: r(a.out.y) };
    if (a.start) out.start = true;
    if (a.close) out.close = true;
    return out;
  });
}

/** Parses a computed dash array ("5px, 3px") into stage lengths; null for solid strokes. */
function dashArray(value: string, k: number, diag: number): string | null {
  if (!value || value === "none") return null;
  const parts = value.split(/[\s,]+/).filter(Boolean);
  const nums = parts.map((p) => (p.endsWith("%") ? (num(p) * diag) / 100 : num(p)) * k);
  if (nums.some((n) => n < 0 || !Number.isFinite(n)) || nums.every((n) => n === 0)) return null;
  return nums.map((n) => formatNumber(n, 3)).join(" ");
}

/**
 * Walks the laid-out sandbox SVG in painter order and converts it into stage layers:
 * basic shapes and paths become path layers (geometry transformed into stage coordinates),
 * `<text>` becomes typed text layers, `<image>` becomes image layers. Group opacity, clip paths,
 * masks and filters are distributed to the leaves; nested `<svg>` viewports become layer clips.
 */
export function convertSvg(root: SVGSVGElement, opts: ConvertOptions): ConvertResult {
  const byId = new Map<string, Element>();
  for (const el of Array.from(root.querySelectorAll("[id]"))) {
    const id = el.getAttribute("id") ?? "";
    if (!byId.has(id)) byId.set(id, el);
  }
  const defs = new DefsBuilder(root.ownerDocument, byId, opts.idPrefix);
  const world: Rect = { x: 0, y: 0, w: opts.world.w, h: opts.world.h };
  const layers: Layer[] = [];
  const masters = new Map<string, { id: string; w: number; h: number; kind: string }>();
  const viewports = new Map<Element, Size>();
  let dropped = 0;
  let visited = 0;

  const stageMatrix = (el: Element): Matrix | null => {
    const ctm = (el as SVGGraphicsElement).getScreenCTM?.();
    if (!ctm) return null;
    const m = multiply(opts.clientToStage, fromDomMatrix(ctm));
    return isFiniteMatrix(m) && Math.abs(determinant(m)) > 1e-12 ? m : null;
  };

  const viewportOf = (el: Element): Size => {
    const vpEl = (el as SVGGraphicsElement).viewportElement ?? root;
    let size = viewports.get(vpEl);
    if (!size) {
      const svg = vpEl as SVGSVGElement;
      const vb = svg.viewBox?.baseVal;
      size =
        vb && vb.width > 0 && vb.height > 0
          ? { w: vb.width, h: vb.height }
          : { w: svg.width?.baseVal?.value || opts.world.w, h: svg.height?.baseVal?.value || opts.world.h };
      viewports.set(vpEl, size);
    }
    return size;
  };

  const bboxOf = (el: Element): Rect | null => {
    try {
      const b = (el as SVGGraphicsElement).getBBox();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch {
      return null;
    }
  };

  const emit = (draft: Draft, frame: Frame, key: string | null): void => {
    const visible = intersect(draft.box, frame.viewport ?? world);
    if (!visible) return;
    if (layers.length >= opts.maxLayers) {
      dropped++;
      return;
    }
    const id = `svg-${layers.length + 1}`;
    const layer = { ...draft, id, z: layers.length, priority: layers.length } as Layer;
    if (draft.kind === "path") layer.box = roundRect(visible);
    else layer.box = roundRect(draft.box);
    if (frame.viewport && !contains(frame.viewport, draft.box)) layer.clip = roundRect(frame.viewport);
    if (key !== null) {
      const first = masters.get(key);
      if (!first) masters.set(key, { id, w: draft.box.w, h: draft.box.h, kind: draft.kind });
      else if (
        first.kind === draft.kind &&
        Math.abs(first.w - draft.box.w) < 0.5 &&
        Math.abs(first.h - draft.box.h) < 0.5
      ) {
        layer.master = first.id;
      }
    }
    layers.push(layer);
  };

  const shape = (el: Element, frame: Frame): void => {
    const cs = computedStyle(el);
    if (cs.visibility !== "visible") return;
    const opacity = frame.opacity * num(cs.opacity, 1);
    if (opacity <= 0.001) return;
    const segs = elementSegments(el, cs);
    if (segs.length === 0) return;
    const m = stageMatrix(el);
    if (!m) return;
    const viewport = viewportOf(el);
    const ctx: RefContext = { m, bbox: pathBounds(segs), viewport };
    const tag = el.localName;
    const fill = tag === "line" ? "none" : defs.paint(cs.getPropertyValue("fill"), ctx);
    const strokePaint = defs.paint(cs.getPropertyValue("stroke"), ctx);
    const k = meanScale(m);
    const diag = normalizedDiagonal(viewport);
    const swRaw = cs.getPropertyValue("stroke-width");
    const swUser = swRaw.endsWith("%") ? (num(swRaw) * diag) / 100 : num(swRaw, 1);
    const sw = swUser * (cs.getPropertyValue("vector-effect") === "non-scaling-stroke" ? 1 : k);
    const hasStroke = strokePaint !== "none" && sw > 0;
    const hasFill = fill !== "none";

    const attrs: Record<string, string> = {};
    let markers = false;
    if (MARKABLE.has(tag)) {
      for (const prop of MARKER_PROPS) {
        const v = cs.getPropertyValue(prop);
        const id = v && v !== "none" ? defs.marker(v, k) : null;
        if (id) {
          attrs[prop] = `url(#${id})`;
          markers = true;
        }
      }
    }
    if (!hasFill && !hasStroke && !markers) return;

    const stageSegs = transformSegments(segs, m);
    const bounds = pathBounds(stageSegs);
    if (!bounds) return;

    if (hasFill) {
      if (cs.getPropertyValue("fill-rule") === "evenodd") attrs["fill-rule"] = "evenodd";
      const fo = num(cs.getPropertyValue("fill-opacity"), 1);
      if (fo < 1) attrs["fill-opacity"] = formatNumber(fo, 3);
    }
    const join = cs.getPropertyValue("stroke-linejoin");
    if (hasStroke) {
      const so = num(cs.getPropertyValue("stroke-opacity"), 1);
      if (so < 1) attrs["stroke-opacity"] = formatNumber(so, 3);
      const cap = cs.getPropertyValue("stroke-linecap");
      if (cap && cap !== "butt") attrs["stroke-linecap"] = cap;
      if (join && join !== "miter") attrs["stroke-linejoin"] = join;
      const miter = num(cs.getPropertyValue("stroke-miterlimit"), 4);
      if (miter !== 4) attrs["stroke-miterlimit"] = formatNumber(miter, 3);
      const dash = dashArray(cs.getPropertyValue("stroke-dasharray"), k, diag);
      if (dash) {
        attrs["stroke-dasharray"] = dash;
        const offsetRaw = cs.getPropertyValue("stroke-dashoffset");
        const offset = (offsetRaw.endsWith("%") ? (num(offsetRaw) * diag) / 100 : num(offsetRaw)) * k;
        if (offset !== 0) attrs["stroke-dashoffset"] = formatNumber(offset, 3);
      }
    }
    const order = cs.getPropertyValue("paint-order");
    if (order && order !== "normal") attrs["paint-order"] = order;
    const rendering = cs.getPropertyValue("shape-rendering");
    if (rendering && rendering !== "auto") attrs["shape-rendering"] = rendering;
    const styles: string[] = [];
    const blend = cs.getPropertyValue("mix-blend-mode");
    if (blend && blend !== "normal") styles.push(`mix-blend-mode:${blend}`);

    const ownClip = cs.getPropertyValue("clip-path");
    const clip = ownClip && ownClip !== "none" ? defs.clip(ownClip, ctx, frame.clip) : frame.clip;
    if (clip) attrs["clip-path"] = `url(#${clip})`;
    const ownMask = maskValue(cs);
    const mask = (ownMask !== "none" ? defs.mask(ownMask, ctx) : null) ?? frame.mask;
    if (mask) attrs.mask = `url(#${mask})`;
    const ownFilter = cs.getPropertyValue("filter");
    const filter = (ownFilter && ownFilter !== "none" ? defs.filter(ownFilter, ctx) : null) ?? frame.filter;
    // Reference filters work as attributes; CSS filter functions need the style property.
    if (filter?.startsWith("url(")) attrs.filter = filter;
    else if (filter) styles.push(`filter:${filter}`);
    if (styles.length > 0) attrs.style = styles.join(";");

    let pad = hasStroke ? (sw / 2) * (join === "miter" || join === "miter-clip" ? Math.SQRT2 : 1) : 0;
    if (markers) pad += Math.max(sw, 1) * 3;
    if (filter) pad += Math.max(8, 0.1 * Math.max(bounds.w, bounds.h));
    const box = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + 2 * pad, h: bounds.h + 2 * pad };

    let reveal: PathReveal = hasStroke ? "pen" : "trace";
    if (bounds.w + bounds.h < TINY) reveal = "fade";
    const closed = stageSegs.some((s) => s.type === "Z");
    const draft: Omit<PathLayer, "id"> = {
      kind: "path",
      box,
      d: serializePath(stageSegs),
      fill,
      reveal,
      role: "shape",
      opacity: opacity < 1 ? Math.round(opacity * 1000) / 1000 : undefined,
      meta: { tag, closed, anchors: compactAnchors(extractAnchors(stageSegs, opts.anchorsPerPath)) },
    };
    if (hasStroke) {
      draft.stroke = strokePaint;
      draft.strokeWidth = Math.round(sw * 1000) / 1000;
    }
    if (Object.keys(attrs).length > 0) draft.attrs = attrs;
    emit(draft, frame, el.getAttribute(KEY_ATTR));
  };

  const image = (el: SVGImageElement, frame: Frame): void => {
    const href = el.getAttribute("href") ?? el.getAttributeNS(XLINK_NS, "href");
    if (!href) return;
    const cs = computedStyle(el);
    if (cs.visibility !== "visible") return;
    const opacity = frame.opacity * num(cs.opacity, 1);
    const w = el.width.baseVal.value;
    const h = el.height.baseVal.value;
    const m = stageMatrix(el);
    if (!m || !(w > 0 && h > 0) || opacity <= 0.001) return;
    const { box, transform } = placeRect({ x: el.x.baseVal.value, y: el.y.baseVal.value, w, h }, m);
    const par = el.getAttribute("preserveAspectRatio") ?? "";
    const fit = par.trim().startsWith("none") ? "fill" : par.includes("slice") ? "cover" : "contain";
    emit(
      {
        kind: "image",
        box,
        transform,
        src: href.trim(),
        fit,
        reveal: "sweep",
        role: "figure",
        opacity: opacity < 1 ? opacity : undefined,
        meta: { tag: "image" },
      },
      frame,
      el.getAttribute(KEY_ATTR),
    );
  };

  const text = (el: SVGTextElement, frame: Frame): void => {
    const cs = computedStyle(el);
    if (cs.visibility !== "visible" && el.querySelector("tspan") === null) return;
    const m = stageMatrix(el);
    if (!m) return;
    for (const draft of convertText(el, { m, groupOpacity: frame.opacity, byId })) {
      if ((draft.opacity ?? 1) <= 0.001) continue;
      if (draft.opacity === 1) draft.opacity = undefined;
      emit(draft, frame, null);
    }
  };

  /** Group state for the children of `el`. */
  const enter = (el: Element, frame: Frame): Frame => {
    const cs = computedStyle(el);
    const next: Frame = { ...frame, opacity: frame.opacity * num(cs.opacity, 1) };
    if (el.localName === "svg" && el !== root) {
      const parentM = el.parentElement ? stageMatrix(el.parentElement) : null;
      const svg = el as SVGSVGElement;
      const overflow = cs.overflow;
      if (parentM && (overflow === "hidden" || overflow === "clip" || overflow === "")) {
        const r = transformRect(parentM, {
          x: svg.x.baseVal.value,
          y: svg.y.baseVal.value,
          w: svg.width.baseVal.value,
          h: svg.height.baseVal.value,
        });
        next.viewport = frame.viewport ? intersect(frame.viewport, r) : r;
      }
      return next;
    }
    const clip = cs.getPropertyValue("clip-path");
    const mask = maskValue(cs);
    const filter = cs.getPropertyValue("filter");
    const effects = (clip && clip !== "none") || mask !== "none" || (filter && filter !== "none");
    if (!effects) return next;
    const m = stageMatrix(el);
    if (!m) return next;
    const ctx: RefContext = { m, bbox: bboxOf(el), viewport: viewportOf(el) };
    if (clip && clip !== "none") next.clip = defs.clip(clip, ctx, frame.clip);
    if (mask !== "none") next.mask = defs.mask(mask, ctx) ?? frame.mask;
    if (filter && filter !== "none") next.filter = defs.filter(filter, ctx) ?? frame.filter;
    return next;
  };

  const rootFrame = enter(root, { opacity: 1, clip: null, mask: null, filter: null, viewport: null });
  const stack: Array<[Element, Frame]> = [];
  const pushChildren = (el: Element, frame: Frame): void => {
    let kids = Array.from(el.children);
    if (el.localName === "switch") {
      const first = kids.find((c) => !NON_RENDERED.has(c.localName));
      kids = first ? [first] : [];
    }
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i] as Element, frame]);
  };
  pushChildren(root, rootFrame);

  while (stack.length > 0) {
    const [el, frame] = stack.pop() as [Element, Frame];
    if (++visited % 256 === 0 && opts.signal?.aborted) {
      throw opts.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    }
    const tag = el.localName;
    if (el.namespaceURI !== SVG_NS || NON_RENDERED.has(tag)) continue;
    if (layers.length >= opts.maxLayers) {
      // Past the limit: only count what is left.
      if (SHAPE_TAGS.has(tag) || tag === "text" || tag === "image") dropped++;
      else if (GROUPS.has(tag)) pushChildren(el, frame);
      continue;
    }
    if (computedStyle(el).display === "none") continue;
    if (GROUPS.has(tag)) pushChildren(el, enter(el, frame));
    else if (SHAPE_TAGS.has(tag)) shape(el, frame);
    else if (tag === "text") text(el as SVGTextElement, frame);
    else if (tag === "image") image(el as SVGImageElement, frame);
  }
  return { layers, dropped, defs };
}
