import type { Rect, Size } from "@swarmloom/core";
import {
  applyToPoint,
  applyToVector,
  formatNumber,
  IDENTITY,
  type Matrix,
  matrixKey,
  matrixToString,
  meanScale,
  multiply,
  rectToMatrix,
  scale,
  transformRect,
} from "./path/geometry";
import { parseNumberList } from "./path/parse";
import { copyStop, firstAttr, hrefChain, patternContentOf, RawCopier, stopsOf, transformOf } from "./raw";
import { computedStyle, parsePaint, urlIds } from "./style";
import { normalizedDiagonal, parseLength, parseViewBox, SVG_NS } from "./units";

/** How a referencing element sees its paint servers, clips, masks and filters. */
export interface RefContext {
  /** User space of the referencing element -> stage. */
  m: Matrix;
  /** Object bounding box of the referencing element in its user space (objectBoundingBox units). */
  bbox: Rect | null;
  /** Size of the nearest viewport in user units (percentage lengths). */
  viewport: Size;
}

const GRADIENTS = new Set(["linearGradient", "radialGradient"]);
const PATTERNS = new Set(["pattern"]);
const CLIP_CHILDREN = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "use"]);
const LIGHTS = new Set(["fePointLight", "feSpotLight"]);
const MAX_CLIP_NESTING = 8;

type Axis = "x" | "y" | "d";

function validBox(b: Rect | null): b is Rect {
  return b !== null && b.w > 0 && b.h > 0;
}

function rectKey(r: Rect | null): string {
  return r ? `${formatNumber(r.x, 3)},${formatNumber(r.y, 3)},${formatNumber(r.w, 3)},${formatNumber(r.h, 3)}` : "-";
}

/**
 * Resolves a length attribute. In objectBoundingBox units numbers and percentages are fractions
 * of the box; in user space percentages resolve against the viewport.
 */
function resolveLength(value: string, axis: Axis, bboxUnits: boolean, viewport: Size): number {
  const v = value.trim();
  if (bboxUnits) {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n)) return 0;
    return v.endsWith("%") ? n / 100 : n;
  }
  const base = axis === "x" ? viewport.w : axis === "y" ? viewport.h : normalizedDiagonal(viewport);
  return parseLength(v, base) ?? 0;
}

/** Scales every `px` length in a CSS filter function list (e.g. `blur(2px) drop-shadow(...)`). */
export function scaleCssLengths(value: string, k: number): string {
  return value.replace(/(-?\d*\.?\d+(?:e[+-]?\d+)?)px/gi, (_m, n: string) => `${formatNumber(Number(n) * k, 3)}px`);
}

/**
 * Collects the definitions that stage-space path layers reference.
 *
 * Path layers carry geometry already transformed into stage coordinates, so every paint server,
 * clip path, mask, filter and marker they use is re-expressed for that space: units become
 * `userSpaceOnUse`, the referencing element's transform (and object bounding box, when the
 * original used `objectBoundingBox`) is folded into gradient/pattern transforms, clip children
 * transforms, mask content groups and filter lengths. Results are cached per reference and
 * transform, so shapes in the same group share definitions.
 */
export class DefsBuilder {
  /** Output `<defs>` element (detached); serialise with {@link DefsBuilder.markup}. */
  readonly defs: Element;
  private readonly raw: RawCopier;
  private readonly cache = new Map<string, string>();
  private counter = 0;

  constructor(
    doc: Document,
    private readonly byId: ReadonlyMap<string, Element>,
    private readonly prefix: string,
  ) {
    this.defs = doc.createElementNS(SVG_NS, "defs");
    this.raw = new RawCopier(byId, this.defs, (kind) => this.nextId(kind));
  }

  /** Number of top-level definitions emitted. */
  get size(): number {
    return this.defs.childElementCount;
  }

  /** Serialised definitions (children of `<defs>`), ready for the `svg:defs` layer. */
  markup(): string {
    const serializer = new XMLSerializer();
    return Array.from(this.defs.children, (c) => serializer.serializeToString(c)).join("");
  }

  private nextId(kind: string): string {
    return `${this.prefix}-${kind}${this.counter++}`;
  }

  private remember(key: string, build: () => Element | null): string | null {
    const known = this.cache.get(key);
    if (known !== undefined) return known || null;
    const el = build();
    if (!el) {
      this.cache.set(key, "");
      return null;
    }
    const id = this.nextId(el.localName.slice(0, 1));
    el.setAttribute("id", id);
    this.defs.appendChild(el);
    this.cache.set(key, id);
    return id;
  }

  private create(tag: string): Element {
    return this.defs.ownerDocument.createElementNS(SVG_NS, tag);
  }

  /**
   * Converts a computed `fill`/`stroke` value. Returns a colour, `none`, or `url(#id)` of a
   * stage-space paint server. Broken references fall back as browsers do.
   */
  paint(value: string, ctx: RefContext): string {
    const p = parsePaint(value);
    if (!p.ref) return p.colour;
    const el = this.byId.get(p.ref);
    if (!el) return p.colour;
    if (GRADIENTS.has(el.localName)) return this.gradient(el, p.ref, ctx);
    if (el.localName === "pattern") return this.pattern(el, p.ref, ctx);
    return p.colour;
  }

  private gradient(el: Element, ref: string, ctx: RefContext): string {
    const chain = hrefChain(el, this.byId, GRADIENTS);
    const stops = stopsOf(chain);
    if (stops.length === 0) return "none";
    const attr = (name: string): string | null => firstAttr(chain, name);
    const bboxUnits = attr("gradientUnits") !== "userSpaceOnUse";
    if (bboxUnits && !validBox(ctx.bbox)) return "none";
    const base = bboxUnits && ctx.bbox ? rectToMatrix(ctx.bbox) : IDENTITY;
    const m = multiply(ctx.m, multiply(base, transformOf(chain, "gradientTransform")));
    const id = this.remember(`g|${ref}|${matrixKey(m)}`, () => {
      const out = this.create(el.localName);
      const len = (name: string, fallback: string, axis: Axis): number =>
        resolveLength(attr(name) ?? fallback, axis, bboxUnits, ctx.viewport);
      const set = (name: string, v: number): void => out.setAttribute(name, formatNumber(v, 5));
      if (el.localName === "linearGradient") {
        set("x1", len("x1", "0%", "x"));
        set("y1", len("y1", "0%", "y"));
        set("x2", len("x2", "100%", "x"));
        set("y2", len("y2", "0%", "y"));
      } else {
        const cx = len("cx", "50%", "x");
        const cy = len("cy", "50%", "y");
        set("cx", cx);
        set("cy", cy);
        set("r", len("r", "50%", "d"));
        set("fx", attr("fx") === null ? cx : len("fx", "50%", "x"));
        set("fy", attr("fy") === null ? cy : len("fy", "50%", "y"));
        const fr = len("fr", "0%", "d");
        if (fr > 0) set("fr", fr);
      }
      out.setAttribute("gradientUnits", "userSpaceOnUse");
      out.setAttribute("gradientTransform", matrixToString(m));
      const spread = attr("spreadMethod");
      if (spread) out.setAttribute("spreadMethod", spread);
      let min = 0;
      for (const stop of stops) {
        const [copy, offset] = copyStop(this.defs.ownerDocument, stop, min);
        min = offset;
        out.appendChild(copy);
      }
      return out;
    });
    return id ? `url(#${id})` : "none";
  }

  private pattern(el: Element, ref: string, ctx: RefContext): string {
    const chain = hrefChain(el, this.byId, PATTERNS);
    const content = patternContentOf(chain);
    if (content.length === 0) return "none";
    const attr = (name: string): string | null => firstAttr(chain, name);
    const unitsBox = attr("patternUnits") !== "userSpaceOnUse";
    const viewBox = parseViewBox(attr("viewBox"));
    const contentBox = !viewBox && attr("patternContentUnits") === "objectBoundingBox";
    if ((unitsBox || contentBox) && !validBox(ctx.bbox)) return "none";
    const len = (name: string, axis: Axis): number => resolveLength(attr(name) ?? "0", axis, unitsBox, ctx.viewport);
    let tile: Rect = { x: len("x", "x"), y: len("y", "y"), w: len("width", "x"), h: len("height", "y") };
    if (!(tile.w > 0 && tile.h > 0)) return "none";
    const box = ctx.bbox;
    if (unitsBox && box) {
      tile = { x: box.x + tile.x * box.w, y: box.y + tile.y * box.h, w: tile.w * box.w, h: tile.h * box.h };
    }
    const m = multiply(ctx.m, transformOf(chain, "patternTransform"));
    const key = `p|${ref}|${matrixKey(m)}|${rectKey(tile)}|${contentBox ? rectKey(box) : ""}`;
    const id = this.remember(key, () => {
      const out = this.create("pattern");
      out.setAttribute("patternUnits", "userSpaceOnUse");
      out.setAttribute("patternContentUnits", "userSpaceOnUse");
      out.setAttribute("x", formatNumber(tile.x, 4));
      out.setAttribute("y", formatNumber(tile.y, 4));
      out.setAttribute("width", formatNumber(tile.w, 4));
      out.setAttribute("height", formatNumber(tile.h, 4));
      out.setAttribute("patternTransform", matrixToString(m));
      let parent: Element = out;
      if (viewBox) {
        out.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
        const par = attr("preserveAspectRatio");
        if (par) out.setAttribute("preserveAspectRatio", par);
      } else if (contentBox && box) {
        // Content coordinates are fractions of the box, with the origin at the tile origin.
        const g = this.create("g");
        g.setAttribute("transform", matrixToString(scale(box.w, box.h)));
        out.appendChild(g);
        parent = g;
      }
      for (const child of content) parent.appendChild(this.raw.clone(child));
      return out;
    });
    return id ? `url(#${id})` : "none";
  }

  /**
   * Converts a computed `clip-path` into a stage-space clip path id. `outer` is an already
   * converted ancestor clip that must intersect with this one. CSS basic shapes are not supported
   * and leave the outer clip in place.
   */
  clip(value: string, ctx: RefContext, outer?: string | null, depth = 0): string | null {
    const ref = urlIds(value)[0];
    const el = ref ? this.byId.get(ref) : undefined;
    if (!ref || !el || el.localName !== "clipPath" || depth > MAX_CLIP_NESTING) return outer ?? null;
    const bboxUnits = el.getAttribute("clipPathUnits") === "objectBoundingBox";
    if (bboxUnits && !validBox(ctx.bbox)) return outer ?? null;
    const base = bboxUnits && ctx.bbox ? rectToMatrix(ctx.bbox) : IDENTITY;
    const m = multiply(ctx.m, multiply(base, transformOf([el], "transform")));
    // A clip-path on the clipPath element itself intersects in the referencing element's space.
    const own = computedStyle(el).getPropertyValue("clip-path");
    const inner = own && own !== "none" ? this.clip(own, ctx, outer, depth + 1) : (outer ?? null);
    return this.remember(`c|${ref}|${matrixKey(m)}|${inner ?? ""}`, () => {
      const out = this.create("clipPath");
      out.setAttribute("clipPathUnits", "userSpaceOnUse");
      if (inner) out.setAttribute("clip-path", `url(#${inner})`);
      for (const child of Array.from(el.children)) {
        if (!CLIP_CHILDREN.has(child.localName)) continue;
        const copy = this.raw.clone(child, { dropTransform: true });
        copy.setAttribute("transform", matrixToString(multiply(m, transformOf([child], "transform"))));
        out.appendChild(copy);
      }
      return out;
    });
  }

  /** Converts a computed mask reference into a stage-space mask id. */
  mask(value: string, ctx: RefContext): string | null {
    const ref = urlIds(value)[0];
    const el = ref ? this.byId.get(ref) : undefined;
    if (!ref || !el || el.localName !== "mask") return null;
    const regionBox = el.getAttribute("maskUnits") !== "userSpaceOnUse";
    const contentBox = el.getAttribute("maskContentUnits") === "objectBoundingBox";
    if ((regionBox || contentBox) && !validBox(ctx.bbox)) return null;
    const region = this.region(el, regionBox, ctx);
    const key = `m|${ref}|${matrixKey(ctx.m)}|${rectKey(ctx.bbox)}`;
    return this.remember(key, () => {
      const out = this.create("mask");
      out.setAttribute("maskUnits", "userSpaceOnUse");
      out.setAttribute("maskContentUnits", "userSpaceOnUse");
      setRect(out, transformRect(ctx.m, region));
      const type = computedStyle(el).getPropertyValue("mask-type");
      if (type === "alpha") out.setAttribute("style", "mask-type:alpha");
      const g = this.create("g");
      const content = contentBox && ctx.bbox ? rectToMatrix(ctx.bbox) : IDENTITY;
      g.setAttribute("transform", matrixToString(multiply(ctx.m, content)));
      for (const child of Array.from(el.children)) g.appendChild(this.raw.clone(child));
      out.appendChild(g);
      return out;
    });
  }

  /** Filter or mask region (x, y, width, height; default -10%/120%) in the element's user space. */
  private region(el: Element, bboxUnits: boolean, ctx: RefContext): Rect {
    const get = (name: string, fallback: string, axis: Axis): number =>
      resolveLength(el.getAttribute(name) ?? fallback, axis, bboxUnits, ctx.viewport);
    const r = {
      x: get("x", "-10%", "x"),
      y: get("y", "-10%", "y"),
      w: get("width", "120%", "x"),
      h: get("height", "120%", "y"),
    };
    const b = ctx.bbox;
    return bboxUnits && b ? { x: b.x + r.x * b.w, y: b.y + r.y * b.h, w: r.w * b.w, h: r.h * b.h } : r;
  }

  /**
   * Converts a computed `filter`. CSS filter functions get their px lengths scaled; a `url()`
   * reference becomes a stage-space filter whose lengths and offsets follow the element transform
   * (exact for translate/uniform scale/rotation; non-uniform scales use the mean scale).
   */
  filter(value: string, ctx: RefContext): string | null {
    if (!value || value === "none") return null;
    const k = meanScale(ctx.m);
    if (!value.includes("url(")) return scaleCssLengths(value, k);
    const ref = urlIds(value)[0];
    const el = ref ? this.byId.get(ref) : undefined;
    if (!ref || !el || el.localName !== "filter") return null;
    const regionBox = el.getAttribute("filterUnits") !== "userSpaceOnUse";
    const primBox = el.getAttribute("primitiveUnits") === "objectBoundingBox";
    if ((regionBox || primBox) && !validBox(ctx.bbox)) return null;
    const region = this.region(el, regionBox, ctx);
    const key = `f|${ref}|${matrixKey(ctx.m)}|${rectKey(ctx.bbox)}`;
    const id = this.remember(key, () => {
      const out = this.create("filter");
      out.setAttribute("filterUnits", "userSpaceOnUse");
      out.setAttribute("primitiveUnits", "userSpaceOnUse");
      setRect(out, transformRect(ctx.m, region));
      const cif = computedStyle(el).getPropertyValue("color-interpolation-filters");
      if (cif && cif !== "linearrgb") out.setAttribute("color-interpolation-filters", cif);
      for (const child of Array.from(el.children)) {
        if (!child.localName.startsWith("fe")) continue;
        const copy = this.raw.clone(child);
        adjustPrimitive(copy, ctx, primBox ? ctx.bbox : null, region);
        out.appendChild(copy);
      }
      return out;
    });
    return id ? `url(#${id})` : null;
  }

  /**
   * Copies a marker referenced by `marker-start/mid/end`. Markers in `strokeWidth` units scale with
   * the (already scaled) stroke width; `userSpaceOnUse` markers are scaled by `k` explicitly.
   */
  marker(value: string, k: number): string | null {
    const ref = urlIds(value)[0];
    const el = ref ? this.byId.get(ref) : undefined;
    if (!ref || !el || el.localName !== "marker") return null;
    const userUnits = el.getAttribute("markerUnits") === "userSpaceOnUse";
    const key = `k|${ref}|${userUnits ? formatNumber(k, 4) : ""}`;
    return this.remember(key, () => {
      const copy = this.raw.clone(el);
      if (userUnits && Math.abs(k - 1) > 1e-6) {
        const mw = parseLength(el.getAttribute("markerWidth")) ?? 3;
        const mh = parseLength(el.getAttribute("markerHeight")) ?? 3;
        if (!copy.hasAttribute("viewBox")) copy.setAttribute("viewBox", `0 0 ${mw} ${mh}`);
        copy.setAttribute("markerWidth", formatNumber(mw * k, 4));
        copy.setAttribute("markerHeight", formatNumber(mh * k, 4));
      }
      return copy;
    });
  }
}

function setRect(el: Element, r: Rect): void {
  el.setAttribute("x", formatNumber(r.x, 3));
  el.setAttribute("y", formatNumber(r.y, 3));
  el.setAttribute("width", formatNumber(r.w, 3));
  el.setAttribute("height", formatNumber(r.h, 3));
}

/**
 * Rewrites the length-bearing attributes of a copied filter primitive for stage space.
 * `box` is set when the filter uses `primitiveUnits="objectBoundingBox"`.
 */
function adjustPrimitive(copy: Element, ctx: RefContext, box: Rect | null, region: Rect): void {
  const k = meanScale(ctx.m);
  const bx = box ? box.w : 1;
  const by = box ? box.h : 1;
  const nums = (name: string): number[] | null => {
    const v = copy.getAttribute(name);
    return v === null ? null : parseNumberList(v);
  };
  const set = (name: string, values: number[]): void =>
    copy.setAttribute(name, values.map((v) => formatNumber(v, 4)).join(" "));

  const sd = nums("stdDeviation");
  if (sd && sd.length > 0) set("stdDeviation", [(sd[0] ?? 0) * bx * k, (sd[1] ?? sd[0] ?? 0) * by * k]);
  const radius = nums("radius");
  if (radius && radius.length > 0) set("radius", [(radius[0] ?? 0) * bx * k, (radius[1] ?? radius[0] ?? 0) * by * k]);
  const disp = nums("scale");
  if (disp && disp.length > 0 && copy.localName === "feDisplacementMap") set("scale", [(disp[0] ?? 0) * bx * k]);
  const freq = nums("baseFrequency");
  if (freq && freq.length > 0 && k > 0)
    set("baseFrequency", [(freq[0] ?? 0) / (bx * k), (freq[1] ?? freq[0] ?? 0) / (by * k)]);
  const kul = nums("kernelUnitLength");
  if (kul && kul.length > 0) set("kernelUnitLength", [(kul[0] ?? 0) * bx * k, (kul[1] ?? kul[0] ?? 0) * by * k]);

  if (copy.localName === "feOffset" || copy.localName === "feDropShadow") {
    const fallback = copy.localName === "feDropShadow" ? 2 : 0;
    const dx = (nums("dx")?.[0] ?? fallback) * bx;
    const dy = (nums("dy")?.[0] ?? fallback) * by;
    const v = applyToVector(ctx.m, dx, dy);
    set("dx", [v.x]);
    set("dy", [v.y]);
  }

  // Primitive subregion: missing values default to the filter region.
  if (["x", "y", "width", "height"].some((n) => copy.hasAttribute(n))) {
    const val = (name: string, axis: "x" | "y", isSize: boolean, fallback: number): number => {
      const v = nums(name)?.[0];
      if (v === undefined) return fallback;
      if (!box) return v;
      const extent = axis === "x" ? box.w : box.h;
      return isSize ? v * extent : (axis === "x" ? box.x : box.y) + v * extent;
    };
    const sub: Rect = {
      x: val("x", "x", false, region.x),
      y: val("y", "y", false, region.y),
      w: val("width", "x", true, region.w),
      h: val("height", "y", true, region.h),
    };
    setRect(copy, transformRect(ctx.m, sub));
  }

  for (const light of Array.from(copy.children)) {
    if (!LIGHTS.has(light.localName)) continue;
    for (const [px, py, pz] of [
      ["x", "y", "z"],
      ["pointsAtX", "pointsAtY", "pointsAtZ"],
    ] as const) {
      const x = Number.parseFloat(light.getAttribute(px) ?? "0") || 0;
      const y = Number.parseFloat(light.getAttribute(py) ?? "0") || 0;
      const z = Number.parseFloat(light.getAttribute(pz) ?? "0") || 0;
      const p = applyToPoint(ctx.m, box ? box.x + x * box.w : x, box ? box.y + y * box.h : y);
      light.setAttribute(px, formatNumber(p.x, 3));
      light.setAttribute(py, formatNumber(p.y, 3));
      light.setAttribute(pz, formatNumber(z * k, 3));
    }
  }
}
