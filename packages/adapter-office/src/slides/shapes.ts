/**
 * Shape trees (`p:spTree`) -> flat list of slide nodes in paint order, with group transforms
 * applied and placeholder geometry/styles inherited from the layout and master.
 */

import type { AssetStore } from "../shared/assets";
import { type EmbeddedImage, extensionLabel, imageMime } from "../shared/assets";
import type { Relationships } from "../shared/opc";
import { attr, boolAttr, intAttr, kid, kids, path } from "../shared/xml";
import {
  blipId,
  colorIn,
  cropOf,
  type DrawContext,
  fillElement,
  fillFromRef,
  resolveFill,
  resolveShadow,
  resolveStroke,
} from "./drawing";
import { adjustValues, customGeometry, presetGeometry } from "./geometry";
import type { Fill, Geometry, SlideNode, Xform } from "./model";
import {
  findPlaceholder,
  type MasterPart,
  type PlaceholderIndex,
  type PlaceholderRef,
  type PptxPackage,
  placeholderFamily,
  placeholderOf,
} from "./package";
import { parseTable } from "./table";
import { buildTextBody } from "./text";
import { themeTypeface } from "./theme";

/** Where the shapes being parsed live and what they inherit from. */
export interface ShapeScope {
  pkg: PptxPackage;
  /** Relationships of the part that owns the shapes (for images). */
  rels: Relationships;
  master: MasterPart;
  /** Placeholder indexes to inherit from, nearest first (layout, then master). */
  inherit: PlaceholderIndex[];
  /** Master/layout decoration pass: placeholders there are prompts, not content. */
  skipPlaceholders: boolean;
  draw: DrawContext;
  assets: AssetStore;
  slideNumber: number;
}

type MapXf = (xf: Xform) => Xform;

const identity: MapXf = (xf) => xf;

const GRAPHIC_LABELS: Readonly<Record<string, string>> = {
  chart: "Chart",
  chartex: "Chart",
  diagram: "SmartArt",
  ole: "Embedded object",
};

/** Reads `a:xfrm` / `p:xfrm`. Returns undefined when offset or extent is missing. */
export function readXfrm(xfrm: Element | undefined): Xform | undefined {
  const off = kid(xfrm, "off");
  const ext = kid(xfrm, "ext");
  if (!off || !ext) return undefined;
  const xf = {
    x: intAttr(off, "x", 0),
    y: intAttr(off, "y", 0),
    w: Math.max(0, intAttr(ext, "cx", 0)),
    h: Math.max(0, intAttr(ext, "cy", 0)),
    rot: intAttr(xfrm, "rot", 0) / 60000,
    flipH: boolAttr(xfrm, "flipH", false),
    flipV: boolAttr(xfrm, "flipV", false),
  };
  return [xf.x, xf.y, xf.w, xf.h, xf.rot].every(Number.isFinite) ? xf : undefined;
}

/** Composes a group's child-space -> parent-space transform with the parent's. */
function groupMap(grpSpPr: Element | undefined, parent: MapXf): MapXf {
  const xfrm = kid(grpSpPr, "xfrm");
  const g = readXfrm(xfrm);
  if (!g) return parent;
  const chOff = kid(xfrm, "chOff");
  const chExt = kid(xfrm, "chExt");
  const chX = intAttr(chOff, "x", g.x);
  const chY = intAttr(chOff, "y", g.y);
  const chW = intAttr(chExt, "cx", g.w);
  const chH = intAttr(chExt, "cy", g.h);
  const sx = chW > 0 ? g.w / chW : 1;
  const sy = chH > 0 ? g.h / chH : 1;
  const gcx = g.x + g.w / 2;
  const gcy = g.y + g.h / 2;
  const rad = (g.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return (child) => {
    let cx = g.x + (child.x + child.w / 2 - chX) * sx;
    let cy = g.y + (child.y + child.h / 2 - chY) * sy;
    if (g.flipH) cx = 2 * gcx - cx;
    if (g.flipV) cy = 2 * gcy - cy;
    const dx = cx - gcx;
    const dy = cy - gcy;
    cx = gcx + dx * cos - dy * sin;
    cy = gcy + dx * sin + dy * cos;
    const w = child.w * sx;
    const h = child.h * sy;
    const mirrored = g.flipH !== g.flipV;
    return parent({
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
      rot: (mirrored ? -child.rot : child.rot) + g.rot,
      flipH: child.flipH !== g.flipH,
      flipV: child.flipV !== g.flipV,
    });
  };
}

function nvProps(el: Element): { name: string; hidden: boolean; ph?: PlaceholderRef; nvPr?: Element } {
  const nv = kids(el).find((c) => c.localName.startsWith("nv"));
  const cNvPr = kid(nv, "cNvPr");
  const nvPr = kid(nv, "nvPr");
  return {
    name: attr(cNvPr, "name") ?? "",
    hidden: boolAttr(cNvPr, "hidden", false),
    ph: placeholderOf(nvPr),
    nvPr,
  };
}

function geometryOf(spPr: Element | undefined, inherited: (Element | undefined)[], xf: Xform): Geometry {
  const own = kid(spPr, "custGeom") ?? kid(spPr, "prstGeom");
  const el = own ?? inherited.map((s) => kid(s, "custGeom") ?? kid(s, "prstGeom")).find(Boolean);
  if (el?.localName === "custGeom") return customGeometry(el, xf.w, xf.h) ?? { kind: "rect" };
  return presetGeometry(attr(el, "prst") ?? "rect", xf.w, xf.h, adjustValues(el));
}

/** Parses a shape tree into nodes. Malformed individual shapes are skipped, not fatal. */
export function parseShapeTree(spTree: Element | undefined, scope: ShapeScope, map: MapXf = identity): SlideNode[] {
  const out: SlideNode[] = [];
  for (const el of kids(spTree)) {
    switch (el.localName) {
      case "sp":
      case "cxnSp":
        pushAll(out, parseShape(el, scope, map));
        break;
      case "pic":
        pushAll(out, parsePicture(el, scope, map));
        break;
      case "grpSp": {
        const grpSpPr = kid(el, "grpSpPr");
        if (nvProps(el).hidden) break;
        const groupFill = resolveFill(fillElement(grpSpPr), scope.draw);
        const inner = { ...scope, draw: { ...scope.draw, groupFill: groupFill ?? scope.draw.groupFill } };
        pushAll(out, parseShapeTree(el, inner, groupMap(grpSpPr, map)));
        break;
      }
      case "graphicFrame":
        pushAll(out, parseGraphicFrame(el, scope, map));
        break;
      case "AlternateContent": {
        const branch = kid(el, "Fallback") ?? kid(el, "Choice");
        pushAll(out, parseShapeTree(branch, scope, map));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function pushAll(out: SlideNode[], nodes: SlideNode[] | SlideNode | undefined): void {
  if (!nodes) return;
  if (Array.isArray(nodes)) out.push(...nodes);
  else out.push(nodes);
}

function inheritedShapes(scope: ShapeScope, ph: PlaceholderRef | undefined): Element[] {
  if (!ph) return [];
  return scope.inherit.map((index) => findPlaceholder(index, ph)).filter((e): e is Element => e !== undefined);
}

function parseShape(el: Element, scope: ShapeScope, map: MapXf): SlideNode | undefined {
  const nv = nvProps(el);
  if (nv.hidden || (nv.ph && scope.skipPlaceholders)) return undefined;
  const spPr = kid(el, "spPr");
  const inherited = inheritedShapes(scope, nv.ph);
  const inheritedSpPr = inherited.map((s) => kid(s, "spPr"));
  const raw = readXfrm(kid(spPr, "xfrm")) ?? inheritedSpPr.map((s) => readXfrm(kid(s, "xfrm"))).find(Boolean);
  if (!raw) return undefined;
  const xf = map(raw);
  const ctx = scope.draw;
  const style = kid(el, "style");

  const fillEl = fillElement(spPr) ?? inheritedSpPr.map(fillElement).find(Boolean);
  const fill: Fill = resolveFill(fillEl, ctx) ?? fillFromRef(kid(style, "fillRef"), ctx) ?? { kind: "none" };
  const ln = kid(spPr, "ln") ?? inheritedSpPr.map((s) => kid(s, "ln")).find(Boolean);
  const stroke = resolveStroke(ln, kid(style, "lnRef"), ctx);
  const shadow = resolveShadow(kid(spPr, "effectLst"), kid(style, "effectRef"), ctx);

  const fontRef = kid(style, "fontRef");
  const family = nv.ph ? placeholderFamily(nv.ph.type) : "other";
  const master = scope.master;
  const base = family === "title" ? master.titleStyle : family === "body" ? master.bodyStyle : master.otherStyle;
  const reversed = [...inherited].reverse();
  const text = buildTextBody(
    kid(el, "txBody"),
    {
      lists: [scope.pkg.defaultTextStyle, base, ...reversed.map((s) => path(s, "txBody", "lstStyle"))],
      bodyPrs: reversed.map((s) => path(s, "txBody", "bodyPr")),
      override: fontRef
        ? {
            color: colorIn(fontRef, ctx),
            typeface: themeTypeface(ctx.theme, attr(fontRef, "idx") === "major" ? "+mj-lt" : "+mn-lt"),
          }
        : undefined,
      placeholder: nv.ph?.type,
      slideNumber: scope.slideNumber,
    },
    ctx,
  );

  const geometry = geometryOf(spPr, inheritedSpPr, xf);
  const visibleFill = fill.kind !== "none";
  if (!visibleFill && !stroke && !text) return undefined;
  return { type: "shape", xf, name: nv.name, geometry, fill, stroke, shadow, text };
}

function imageFor(scope: ShapeScope, rId: string | undefined): EmbeddedImage | "unsupported" | undefined {
  const rel = rId ? scope.rels.get(rId) : undefined;
  if (!rel || rel.external || !scope.pkg.zip.has(rel.target)) return undefined;
  if (!imageMime(rel.target)) return "unsupported";
  return scope.assets.image(scope.pkg.zip, rel.target) ?? undefined;
}

function parsePicture(el: Element, scope: ShapeScope, map: MapXf): SlideNode | undefined {
  const nv = nvProps(el);
  if (nv.hidden || (nv.ph && scope.skipPlaceholders)) return undefined;
  const spPr = kid(el, "spPr");
  const inheritedSpPr = inheritedShapes(scope, nv.ph).map((s) => kid(s, "spPr"));
  const raw = readXfrm(kid(spPr, "xfrm")) ?? inheritedSpPr.map((s) => readXfrm(kid(s, "xfrm"))).find(Boolean);
  if (!raw) return undefined;
  const xf = map(raw);
  const blipFill = kid(el, "blipFill");
  const rId = blipId(blipFill);
  const image = imageFor(scope, rId);
  const media = kid(nv.nvPr, "videoFile") ? "Video" : kid(nv.nvPr, "audioFile") ? "Audio" : undefined;
  const poster = typeof image === "object" ? image.src : undefined;
  if (media) return { type: "media", xf, name: nv.name, label: media, poster };
  if (image === "unsupported") {
    const target = rId ? scope.rels.get(rId)?.target : undefined;
    return { type: "media", xf, name: nv.name, label: `Image (${extensionLabel(target ?? "")})` };
  }
  if (!image) return { type: "media", xf, name: nv.name, label: "Image" };
  const style = kid(el, "style");
  return {
    type: "picture",
    xf,
    name: nv.name,
    src: image.src,
    natural: image.natural,
    crop: cropOf(blipFill),
    geometry: geometryOf(spPr, inheritedSpPr, xf),
    stroke: resolveStroke(kid(spPr, "ln"), kid(style, "lnRef"), scope.draw),
    shadow: resolveShadow(kid(spPr, "effectLst"), kid(style, "effectRef"), scope.draw),
  };
}

function parseGraphicFrame(el: Element, scope: ShapeScope, map: MapXf): SlideNode | undefined {
  const nv = nvProps(el);
  if (nv.hidden || (nv.ph && scope.skipPlaceholders)) return undefined;
  const raw = readXfrm(kid(el, "xfrm"));
  if (!raw) return undefined;
  const xf = map(raw);
  const data = path(el, "graphic", "graphicData");
  const uri = attr(data, "uri") ?? "";
  const tbl = kid(data, "tbl");
  if (tbl) {
    const lists = [scope.pkg.defaultTextStyle, scope.master.otherStyle];
    const table = parseTable(tbl, scope.pkg, scope.draw, { lists, slideNumber: scope.slideNumber });
    return table.cols.length && table.rows.length ? { type: "table", xf, name: nv.name, table } : undefined;
  }
  const kind = uri.slice(uri.lastIndexOf("/") + 1);
  return { type: "media", xf, name: nv.name, label: GRAPHIC_LABELS[kind] ?? "Embedded content" };
}
