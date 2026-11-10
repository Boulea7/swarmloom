/**
 * DrawingML colours, fills, outlines and shadows resolved against a theme and colour map.
 */

import {
  adjustLuminance,
  adjustSaturation,
  cssColor,
  hsl,
  PRESET_COLORS,
  parseHex,
  type Rgba,
  shade,
  tint,
} from "../shared/color";
import type { FontLog } from "../shared/fonts";
import { attr, intAttr, kid, kids } from "../shared/xml";
import type { ArrowKind, CropRect, Fill, Shadow, Stroke } from "./model";
import type { Theme } from "./theme";

/** Maps logical scheme names (bg1, tx1, bg2, tx2, accentN, hlink, folHlink) to theme slots. */
export type ColorMap = Readonly<Record<string, string>>;

export const DEFAULT_COLOR_MAP: ColorMap = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
};

/** Everything needed to turn DrawingML colour/fill markup into concrete values. */
export interface DrawContext {
  theme: Theme;
  colorMap: ColorMap;
  /** Placeholder colour substituted for `phClr` inside theme styles. */
  phClr?: Rgba;
  /** Fill of the enclosing group, used by `grpFill`. */
  groupFill?: Fill;
  /** Resolves an `r:embed` image reference to a URL (and natural size when known). */
  image?(rId: string): { src: string; natural?: { w: number; h: number } } | undefined;
  /** Collects the typefaces of visible text (for the font substitution note). */
  fonts?: FontLog;
}

const COLOR_TAGS = new Set(["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"]);
const FILL_TAGS = new Set(["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"]);

/** Parses a `p:clrMap` / `a:overrideClrMapping` element. */
export function parseColorMap(el: Element | undefined): ColorMap | undefined {
  if (!el) return undefined;
  const map: Record<string, string> = {};
  for (const key of ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]) {
    const v = attr(el, key);
    if (v) map[key] = v;
  }
  for (const key of ["hlink", "folHlink"]) {
    const v = attr(el, key);
    if (v) map[key] = v;
  }
  return map;
}

function pct(el: Element): number {
  return intAttr(el, "val", 100000) / 100000;
}

function baseColor(el: Element, ctx: DrawContext, depth: number): Rgba | undefined {
  switch (el.localName) {
    case "srgbClr":
      return parseHex(attr(el, "val"));
    case "sysClr": {
      const last = parseHex(attr(el, "lastClr"));
      if (last) return last;
      return parseHex(attr(el, "val") === "window" ? "FFFFFF" : "000000");
    }
    case "prstClr":
      return parseHex(PRESET_COLORS[attr(el, "val") ?? ""]);
    case "scrgbClr": {
      // Linear RGB percentages; convert to sRGB.
      const ch = (name: string) => {
        const lin = Math.min(1, Math.max(0, intAttr(el, name, 0) / 100000));
        const s = lin <= 0.0031308 ? lin * 12.92 : 1.055 * lin ** (1 / 2.4) - 0.055;
        return s * 255;
      };
      return { r: ch("r"), g: ch("g"), b: ch("b"), a: 1 };
    }
    case "hslClr":
      return hsl(intAttr(el, "hue", 0) / 21600000, intAttr(el, "sat", 0) / 100000, intAttr(el, "lum", 0) / 100000);
    case "schemeClr": {
      const val = attr(el, "val") ?? "";
      if (val === "phClr") return ctx.phClr;
      return depth < 4 ? schemeColor(val, ctx, depth + 1) : undefined;
    }
    default:
      return undefined;
  }
}

/** Applies colour transforms (alpha, tint, shade, lumMod, lumOff, satMod, satOff) in document order. */
function applyTransforms(color: Rgba, el: Element): Rgba {
  let c = color;
  let lumMod = 1;
  let lumOff = 0;
  let hasLum = false;
  for (const t of kids(el)) {
    switch (t.localName) {
      case "alpha":
        c = { ...c, a: pct(t) };
        break;
      case "alphaMod":
        c = { ...c, a: c.a * pct(t) };
        break;
      case "tint":
        c = tint(c, pct(t));
        break;
      case "shade":
        c = shade(c, pct(t));
        break;
      case "lumMod":
        lumMod = pct(t);
        hasLum = true;
        break;
      case "lumOff":
        lumOff = pct(t);
        hasLum = true;
        break;
      case "satMod":
        c = adjustSaturation(c, pct(t), 0);
        break;
      case "satOff":
        c = adjustSaturation(c, 1, pct(t));
        break;
      default:
        break;
    }
  }
  return hasLum ? adjustLuminance(c, lumMod, lumOff) : c;
}

/** Resolves a scheme colour name (tx1, accent2, ...) through the colour map and theme. */
export function schemeColor(val: string, ctx: DrawContext, depth = 0): Rgba | undefined {
  const slot = ctx.colorMap[val] ?? DEFAULT_COLOR_MAP[val] ?? val;
  const source = ctx.theme.colors.get(slot);
  return source ? resolveColor(source, ctx, depth) : undefined;
}

/** Resolves one colour element (`a:srgbClr`, `a:schemeClr`, ...) including its transforms. */
export function resolveColor(el: Element | undefined, ctx: DrawContext, depth = 0): Rgba | undefined {
  if (!el) return undefined;
  const base = baseColor(el, ctx, depth);
  return base ? applyTransforms(base, el) : undefined;
}

/** First colour child of `parent` (e.g. the inside of `a:solidFill`), resolved. */
export function colorIn(parent: Element | undefined, ctx: DrawContext): Rgba | undefined {
  if (!parent) return undefined;
  for (const c of kids(parent)) if (COLOR_TAGS.has(c.localName)) return resolveColor(c, ctx);
  return undefined;
}

/** The fill element directly inside `container` (spPr, bgPr, tcPr, rPr ...). */
export function fillElement(container: Element | undefined): Element | undefined {
  for (const c of kids(container)) if (FILL_TAGS.has(c.localName)) return c;
  return undefined;
}

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t };
}

function gradientFill(el: Element, ctx: DrawContext): Fill | undefined {
  const stops = kids(kid(el, "gsLst"), "gs")
    .map((gs) => ({ pos: intAttr(gs, "pos", 0) / 1000, color: colorIn(gs, ctx) }))
    .filter((s): s is { pos: number; color: Rgba } => s.color !== undefined)
    .sort((a, b) => a.pos - b.pos);
  const first = stops[0];
  if (!first) return undefined;
  if (stops.length === 1) return { kind: "solid", color: first.color };
  const list = stops.map((s) => `${cssColor(s.color)} ${Math.round(s.pos * 100) / 100}%`).join(", ");
  const pathEl = kid(el, "path");
  if (pathEl) {
    const rect = kid(pathEl, "fillToRect");
    const l = intAttr(rect, "l", 50000) / 1000;
    const t = intAttr(rect, "t", 50000) / 1000;
    const shape = attr(pathEl, "path") === "circle" ? "circle" : "ellipse";
    return { kind: "gradient", css: `radial-gradient(${shape} at ${l}% ${t}%, ${list})`, first: first.color };
  }
  const angle = intAttr(kid(el, "lin"), "ang", 0) / 60000;
  // DrawingML 0deg runs left to right and grows clockwise; CSS 90deg is "to right".
  return {
    kind: "gradient",
    css: `linear-gradient(${Math.round((angle + 90) * 100) / 100}deg, ${list})`,
    first: first.color,
  };
}

/** `a:srcRect` crop as fractions, or undefined when absent or empty. */
export function cropOf(blipFill: Element | undefined): CropRect | undefined {
  const rect = kid(blipFill, "srcRect");
  if (!rect) return undefined;
  const crop = {
    l: intAttr(rect, "l", 0) / 100000,
    t: intAttr(rect, "t", 0) / 100000,
    r: intAttr(rect, "r", 0) / 100000,
    b: intAttr(rect, "b", 0) / 100000,
  };
  return crop.l || crop.t || crop.r || crop.b ? crop : undefined;
}

/** Embedded image id of a `blipFill` (`a:blip r:embed`). */
export function blipId(blipFill: Element | undefined): string | undefined {
  const blip = kid(blipFill, "blip");
  if (!blip) return undefined;
  const attrs = blip.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    if (a && (a.localName === "embed" || a.name.endsWith(":embed"))) return a.value;
  }
  return undefined;
}

/** Resolves a fill element (`a:solidFill`, `a:gradFill`, ...). */
export function resolveFill(el: Element | undefined, ctx: DrawContext): Fill | undefined {
  if (!el) return undefined;
  switch (el.localName) {
    case "noFill":
      return { kind: "none" };
    case "solidFill": {
      const color = colorIn(el, ctx);
      return color ? { kind: "solid", color } : undefined;
    }
    case "gradFill":
      return gradientFill(el, ctx);
    case "pattFill": {
      const fg = colorIn(kid(el, "fgClr"), ctx);
      const bg = colorIn(kid(el, "bgClr"), ctx);
      if (fg && bg) return { kind: "solid", color: mix(bg, fg, 0.5) };
      return fg || bg ? { kind: "solid", color: (fg ?? bg) as Rgba } : undefined;
    }
    case "grpFill":
      return ctx.groupFill;
    case "blipFill": {
      const id = blipId(el);
      const image = id ? ctx.image?.(id) : undefined;
      return image ? { kind: "image", src: image.src, natural: image.natural, crop: cropOf(el) } : undefined;
    }
    default:
      return undefined;
  }
}

/** Fill from a style reference (`a:fillRef` / `p:bgRef`) into the theme's fill lists. */
export function fillFromRef(ref: Element | undefined, ctx: DrawContext): Fill | undefined {
  if (!ref) return undefined;
  const idx = intAttr(ref, "idx", 0);
  if (idx === 0) return { kind: "none" };
  const list = idx >= 1001 ? ctx.theme.bgFillStyles : ctx.theme.fillStyles;
  const style = list[(idx >= 1001 ? idx - 1001 : idx - 1) as number];
  const phClr = colorIn(ref, ctx);
  const fill = style ? resolveFill(style, { ...ctx, phClr }) : undefined;
  return fill ?? (phClr ? { kind: "solid", color: phClr } : undefined);
}

const ARROWS: ReadonlySet<string> = new Set(["triangle", "arrow", "stealth", "oval", "diamond"]);

function arrowOf(el: Element | undefined): ArrowKind | undefined {
  const type = attr(el, "type");
  return type && ARROWS.has(type) ? (type as ArrowKind) : undefined;
}

/**
 * Resolves an outline. `ln` is the explicit `a:ln` (may be undefined); `ref` is the shape style's
 * `a:lnRef`. Returns undefined when there is no visible outline.
 */
export function resolveStroke(ln: Element | undefined, ref: Element | undefined, ctx: DrawContext): Stroke | undefined {
  let themeLn: Element | undefined;
  let refCtx = ctx;
  if (ref) {
    const idx = intAttr(ref, "idx", 0);
    themeLn = idx > 0 ? ctx.theme.lineStyles[idx - 1] : undefined;
    refCtx = { ...ctx, phClr: colorIn(ref, ctx) };
  }
  const ownFill = fillElement(ln);
  if (ownFill?.localName === "noFill") return undefined;
  let color: Rgba | undefined;
  if (ownFill) color = strokeColor(ownFill, ctx);
  else if (themeLn) {
    const themeFill = fillElement(themeLn);
    if (!themeFill || themeFill.localName === "noFill") return undefined;
    color = strokeColor(themeFill, refCtx);
  }
  if (!color) return undefined;
  const width = intAttr(ln, "w") ?? intAttr(themeLn, "w") ?? 9525;
  const dashEl = kid(ln, "prstDash") ?? kid(themeLn, "prstDash");
  const dash = attr(dashEl, "val");
  return {
    color,
    width,
    dash: dash && dash !== "solid" ? dash : undefined,
    head: arrowOf(kid(ln, "headEnd") ?? kid(themeLn, "headEnd")),
    tail: arrowOf(kid(ln, "tailEnd") ?? kid(themeLn, "tailEnd")),
  };
}

function strokeColor(fillEl: Element, ctx: DrawContext): Rgba | undefined {
  const fill = resolveFill(fillEl, ctx);
  if (!fill) return undefined;
  if (fill.kind === "solid") return fill.color;
  if (fill.kind === "gradient") return fill.first;
  return undefined;
}

/** Outer shadow from an explicit `a:effectLst`, else from the style's `a:effectRef`. */
export function resolveShadow(
  effectLst: Element | undefined,
  ref: Element | undefined,
  ctx: DrawContext,
): Shadow | undefined {
  let list = effectLst;
  let listCtx = ctx;
  if (!list && ref) {
    const idx = intAttr(ref, "idx", 0);
    list = idx > 0 ? ctx.theme.effectStyles[idx - 1] : undefined;
    listCtx = { ...ctx, phClr: colorIn(ref, ctx) };
  }
  const shadow = kid(list, "outerShdw");
  if (!shadow) return undefined;
  const color = colorIn(shadow, listCtx);
  if (!color) return undefined;
  const dist = intAttr(shadow, "dist", 0);
  const dir = (intAttr(shadow, "dir", 0) / 60000) * (Math.PI / 180);
  return { dx: dist * Math.cos(dir), dy: dist * Math.sin(dir), blur: intAttr(shadow, "blurRad", 0), color };
}
