/**
 * {@link Presentation} -> Blueprint layers. Slides are page boxes (role "slide") stacked
 * vertically; their content is emitted back to front so `priority` follows paint order.
 */

import type { BoxLayer, CSSMap, GuideLayer, ImageLayer, Layer, PathLayer, Rect, TextLayer } from "@swarmloom/core";
import { cssColor } from "../shared/color";
import { px, round2 } from "../shared/html";
import { textContent } from "./emit-text";
import type {
  ArrowKind,
  Fill,
  Geometry,
  PathSegment,
  PictureNode,
  Presentation,
  Shadow,
  ShapeNode,
  SlideModel,
  Stroke,
  TableNode,
  TextBody,
  Xform,
} from "./model";

export interface SlideLayout {
  /** World width, px. */
  width: number;
  /** Padding around and gap between slides, px. */
  pad: number;
  /** Slide box size, px. */
  slideW: number;
  slideH: number;
  /** Pixels per EMU. */
  k: number;
}

/** Fits slides to the layout width with a proportional margin. */
export function slideLayout(pres: Presentation, width: number): SlideLayout {
  const pad = Math.min(48, Math.max(16, Math.round(width * 0.035)));
  const slideW = Math.max(160, width - 2 * pad);
  const k = slideW / pres.width;
  return { width: Math.max(width, slideW + 2 * pad), pad, slideW, slideH: pres.height * k, k };
}

const DASHES: Readonly<Record<string, readonly number[]>> = {
  dash: [4, 3],
  sysDash: [3, 1],
  dot: [1, 1],
  sysDot: [1, 1],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

function fillCss(fill: Fill): string {
  switch (fill.kind) {
    case "solid":
      return cssColor(fill.color);
    case "gradient":
      return fill.css;
    default:
      return "transparent";
  }
}

function svgFill(fill: Fill): string {
  if (fill.kind === "solid") return cssColor(fill.color);
  if (fill.kind === "gradient") return cssColor(fill.first);
  return "none";
}

function pathData(segments: PathSegment[], map: (x: number, y: number) => [number, number]): string {
  const n = (v: number) => String(round2(v));
  let d = "";
  for (const s of segments) {
    if (s.op === "Z") {
      d += "Z";
      continue;
    }
    const [x, y] = map(s.x, s.y);
    if (s.op === "C") {
      const [x1, y1] = map(s.x1, s.y1);
      const [x2, y2] = map(s.x2, s.y2);
      d += `C${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)}`;
    } else {
      d += `${s.op}${n(x)} ${n(y)}`;
    }
  }
  return d;
}

/** Collects layers for one slide; ids and priorities are deterministic. */
class SlideEmitter {
  readonly layers: Layer[] = [];
  private seq = 0;
  private readonly id: string;
  private readonly ox: number;
  private readonly oy: number;
  private readonly clip: Rect;

  constructor(
    private readonly slide: SlideModel,
    private readonly layout: SlideLayout,
    top: number,
  ) {
    this.id = `s${slide.number}`;
    this.ox = (layout.width - layout.slideW) / 2;
    this.oy = top;
    this.clip = { x: this.ox, y: this.oy, w: layout.slideW, h: layout.slideH };
  }

  private push<L extends Layer>(layer: L): L {
    layer.priority = (this.slide.number - 1) * 100000 + this.layers.length;
    layer.meta = { slide: this.slide.number, ...layer.meta };
    this.layers.push(layer);
    return layer;
  }

  private nextId(suffix = ""): string {
    this.seq++;
    return `${this.id}-${this.seq}${suffix}`;
  }

  private rect(xf: Xform): Rect {
    const k = this.layout.k;
    return { x: round2(this.ox + xf.x * k), y: round2(this.oy + xf.y * k), w: round2(xf.w * k), h: round2(xf.h * k) };
  }

  private child<L extends Layer>(layer: L, parent?: string): L {
    layer.parent = parent ?? this.id;
    layer.clip = this.clip;
    return this.push(layer);
  }

  emit(): Layer[] {
    const { slide } = this;
    const bg = slide.background;
    this.push<BoxLayer>({
      id: this.id,
      kind: "box",
      role: "slide",
      box: { ...this.clip },
      style: {
        background: bg.kind === "image" ? "#ffffff" : fillCss(bg),
        "box-shadow": "0 1px 2px rgba(11, 11, 18, 0.12), 0 6px 20px rgba(11, 11, 18, 0.10)",
        "border-radius": "3px",
      },
      meta: { label: `Slide ${slide.number}` },
    });
    if (bg.kind === "image") {
      this.child<ImageLayer>({ id: `${this.id}-bg`, kind: "image", box: { ...this.clip }, src: bg.src, fit: "cover" });
    }
    if (slide.error) {
      this.child({ id: `${this.id}-error`, kind: "media", box: { ...this.clip }, label: slide.error });
      return this.layers;
    }
    for (const node of slide.nodes) {
      switch (node.type) {
        case "shape":
          this.shape(node);
          break;
        case "picture":
          this.picture(node);
          break;
        case "table":
          this.table(node);
          break;
        case "media":
          this.child({
            id: this.nextId(),
            kind: "media",
            box: this.rect(node.xf),
            label: node.label,
            src: node.poster,
            transform: rotation(node.xf),
          });
          break;
      }
    }
    this.guide();
    return this.layers;
  }

  private strokeCss(stroke: Stroke): string {
    const dash = stroke.dash?.toLowerCase();
    const style = !dash ? "solid" : dash.includes("dot") && !dash.includes("dash") ? "dotted" : "dashed";
    return `${px(Math.max(0.5, stroke.width * this.layout.k))} ${style} ${cssColor(stroke.color)}`;
  }

  private shadowCss(shadow: Shadow): string {
    const k = this.layout.k;
    return `${px(shadow.dx * k)} ${px(shadow.dy * k)} ${px(shadow.blur * k)} ${cssColor(shadow.color)}`;
  }

  private boxStyle(geometry: Geometry, stroke?: Stroke, shadow?: Shadow): CSSMap {
    const css: CSSMap = { "box-sizing": "border-box" };
    if (geometry.kind === "ellipse") css["border-radius"] = "50%";
    if (geometry.kind === "roundRect") css["border-radius"] = px(geometry.radius * this.layout.k);
    if (stroke) css.border = this.strokeCss(stroke);
    if (shadow) css["box-shadow"] = this.shadowCss(shadow);
    return css;
  }

  private shape(node: ShapeNode): void {
    const box = this.rect(node.xf);
    const transform = rotation(node.xf);
    let parent: string | undefined;
    const g = node.geometry;
    if (g.kind === "path" || g.kind === "line") {
      parent = this.path(node, g.segments, g.kind === "path");
    } else if (node.fill.kind === "image") {
      parent = this.child<ImageLayer>({
        id: this.nextId(),
        kind: "image",
        role: "shape",
        box,
        src: node.fill.src,
        natural: node.fill.natural,
        crop: cropRect(node.fill.natural, node.fill.crop),
        fit: "fill",
        style: this.boxStyle(g, node.stroke, node.shadow),
        transform,
      }).id;
    } else if (node.fill.kind !== "none" || node.stroke) {
      parent = this.child<BoxLayer>({
        id: this.nextId(),
        kind: "box",
        role: "shape",
        box,
        style: { background: fillCss(node.fill), ...this.boxStyle(g, node.stroke, node.shadow) },
        transform,
      }).id;
    }
    if (node.text) this.text(node.text, box, transform, parent);
  }

  /** Emits a path layer (and arrowheads); returns the path layer id. */
  private path(node: ShapeNode, segments: PathSegment[], closed: boolean): string | undefined {
    const { xf } = node;
    const k = this.layout.k;
    const map = (x: number, y: number): [number, number] => [
      this.ox + (xf.x + (xf.flipH ? xf.w - x : x)) * k,
      this.oy + (xf.y + (xf.flipV ? xf.h - y : y)) * k,
    ];
    const fill = closed ? svgFill(node.fill) : "none";
    if (fill === "none" && !node.stroke) return undefined;
    const strokeWidth = node.stroke ? Math.max(0.5, round2(node.stroke.width * k)) : undefined;
    const attrs: Record<string, string> = { "stroke-linejoin": "round", "stroke-linecap": closed ? "butt" : "round" };
    const dash = node.stroke?.dash ? DASHES[node.stroke.dash] : undefined;
    if (dash && strokeWidth) attrs["stroke-dasharray"] = dash.map((v) => round2(v * strokeWidth)).join(" ");
    if (node.fill.kind === "solid" && node.fill.color.a < 1) attrs["fill-opacity"] = String(round2(node.fill.color.a));
    const id = this.child<PathLayer>({
      id: this.nextId(),
      kind: "path",
      role: "shape",
      box: this.rect(xf),
      d: pathData(segments, map),
      fill,
      stroke: node.stroke ? cssColor(node.stroke.color) : undefined,
      strokeWidth,
      attrs,
      transform: rotation(xf),
    }).id;
    if (node.stroke && strokeWidth) {
      const pts = segments.filter((s) => s.op !== "Z").map((s) => map((s as { x: number }).x, (s as { y: number }).y));
      const color = cssColor(node.stroke.color);
      const ends: [ArrowKind | undefined, [number, number] | undefined, [number, number] | undefined][] = [
        [node.stroke.tail, pts[pts.length - 1], pts[pts.length - 2]],
        [node.stroke.head, pts[0], pts[1]],
      ];
      for (const [kind, tip, from] of ends) {
        if (!kind || !tip || !from) continue;
        this.child<PathLayer>(
          {
            id: this.nextId("-arrow"),
            kind: "path",
            box: this.rect(xf),
            d: arrowHead(kind, tip, from, strokeWidth),
            fill: color,
            stroke: color,
            strokeWidth: round2(strokeWidth / 2),
            attrs: { "stroke-linejoin": "round" },
            transform: rotation(xf),
            reveal: "fade",
          },
          id,
        );
      }
    }
    return id;
  }

  private picture(node: PictureNode): void {
    const style = this.boxStyle(node.geometry, node.stroke, node.shadow);
    const flips = [node.xf.flipH ? "scaleX(-1)" : "", node.xf.flipV ? "scaleY(-1)" : ""].filter(Boolean);
    const transform = [rotation(node.xf), ...flips].filter(Boolean).join(" ") || undefined;
    this.child<ImageLayer>({
      id: this.nextId(),
      kind: "image",
      role: "figure",
      box: this.rect(node.xf),
      src: node.src,
      natural: node.natural,
      crop: cropRect(node.natural, node.crop),
      fit: "fill",
      style,
      transform,
    });
  }

  private text(body: TextBody, box: Rect, transform: string | undefined, parent?: string): TextLayer {
    const content = textContent(body, this.layout.k);
    const placeholder = body.placeholder;
    const role =
      placeholder === "title" || placeholder === "ctrTitle"
        ? "heading"
        : body.paragraphs.some((p) => p.bullet)
          ? "list"
          : "paragraph";
    return this.child<TextLayer>(
      {
        id: this.nextId("-text"),
        kind: "text",
        role,
        box,
        html: content.html,
        text: content.text,
        style: content.style,
        fontSize: content.fontSize,
        transform,
      },
      parent,
    );
  }

  private table(node: TableNode): void {
    const { table, xf } = node;
    const k = this.layout.k;
    const tableBox = this.rect(xf);
    const colX = [tableBox.x];
    for (const w of table.cols) colX.push((colX[colX.length - 1] as number) + w * k);
    const rowY = [tableBox.y];
    for (const h of table.rows) rowY.push((rowY[rowY.length - 1] as number) + h * k);
    const gridBox: Rect = {
      x: tableBox.x,
      y: tableBox.y,
      w: round2((colX[colX.length - 1] as number) - tableBox.x),
      h: round2((rowY[rowY.length - 1] as number) - tableBox.y),
    };
    const tableId = this.child<BoxLayer>({
      id: this.nextId(),
      kind: "box",
      role: "table",
      box: gridBox,
      style: {},
      transform: rotation(xf),
    }).id;
    const cellRect = (c: { row: number; col: number; rowSpan: number; colSpan: number }): Rect => {
      const x0 = colX[c.col] as number;
      const y0 = rowY[c.row] as number;
      return {
        x: round2(x0),
        y: round2(y0),
        w: round2((colX[c.col + c.colSpan] as number) - x0),
        h: round2((rowY[c.row + c.rowSpan] as number) - y0),
      };
    };
    const fills = new Map<string, string>();
    for (const cell of table.cells) {
      if (!cell.fill || cell.fill.kind === "none" || cell.fill.kind === "image") continue;
      const id = this.child<BoxLayer>(
        {
          id: this.nextId(),
          kind: "box",
          role: "cell",
          box: cellRect(cell),
          style: { background: fillCss(cell.fill) },
        },
        tableId,
      ).id;
      fills.set(`${cell.row}:${cell.col}`, id);
    }
    this.tableBorders(node, colX, rowY, tableId);
    for (const cell of table.cells) {
      if (!cell.text) continue;
      const layer = this.text(cell.text, cellRect(cell), undefined, fills.get(`${cell.row}:${cell.col}`) ?? tableId);
      layer.role = "cell";
      layer.meta = { ...layer.meta, row: cell.row, col: cell.col, header: cell.row === 0 };
    }
  }

  /** One path layer per distinct stroke; shared edges are drawn once. */
  private tableBorders(node: TableNode, colX: number[], rowY: number[], parent: string): void {
    const groups = new Map<string, { stroke: Stroke; d: string[] }>();
    const seen = new Set<string>();
    const add = (stroke: Stroke | undefined, x1: number, y1: number, x2: number, y2: number) => {
      if (!stroke) return;
      const edge = `${round2(x1)},${round2(y1)},${round2(x2)},${round2(y2)}`;
      if (seen.has(edge)) return;
      seen.add(edge);
      const key = `${cssColor(stroke.color)}|${stroke.width}|${stroke.dash ?? ""}`;
      let group = groups.get(key);
      if (!group) {
        group = { stroke, d: [] };
        groups.set(key, group);
      }
      group.d.push(`M${round2(x1)} ${round2(y1)}L${round2(x2)} ${round2(y2)}`);
    };
    for (const c of node.table.cells) {
      const x0 = colX[c.col] as number;
      const x1 = colX[c.col + c.colSpan] as number;
      const y0 = rowY[c.row] as number;
      const y1 = rowY[c.row + c.rowSpan] as number;
      add(c.borders.t, x0, y0, x1, y0);
      add(c.borders.b, x0, y1, x1, y1);
      add(c.borders.l, x0, y0, x0, y1);
      add(c.borders.r, x1, y0, x1, y1);
    }
    const box = this.rect(node.xf);
    for (const { stroke, d } of groups.values()) {
      this.child<PathLayer>(
        {
          id: this.nextId(),
          kind: "path",
          box,
          d: d.join(""),
          stroke: cssColor(stroke.color),
          strokeWidth: Math.max(0.5, round2(stroke.width * this.layout.k)),
          fill: "none",
          attrs: { "stroke-linecap": "square" },
          reveal: "trace",
        },
        parent,
      );
    }
  }

  /** Adds a guide at the most shared left text edge (two or more text layers) and snaps them to it. */
  private guide(): void {
    const edges = new Map<number, TextLayer[]>();
    for (const layer of this.layers) {
      if (layer.kind !== "text" || layer.transform || layer.role === "cell") continue;
      const pad = Number.parseFloat(layer.style.padding?.split(" ")[3] ?? "0") || 0;
      const x = Math.round(layer.box.x + pad);
      const list = edges.get(x) ?? [];
      list.push(layer);
      edges.set(x, list);
    }
    let best: [number, TextLayer[]] | undefined;
    for (const entry of edges) {
      if (entry[1].length < 2) continue;
      if (!best || entry[1].length > best[1].length || (entry[1].length === best[1].length && entry[0] < best[0])) {
        best = entry;
      }
    }
    if (!best) return;
    const [x, texts] = best;
    const guideId = `${this.id}-guide`;
    const guide: GuideLayer = {
      id: guideId,
      kind: "guide",
      axis: "x",
      pos: x,
      box: { x, y: this.clip.y, w: 0, h: this.clip.h },
      parent: this.id,
      priority: (this.slide.number - 1) * 100000 + 0.5,
      meta: { slide: this.slide.number },
    };
    // Guides go right after the slide box so they are planned before the text that snaps to them.
    this.layers.splice(1, 0, guide);
    for (const t of texts) t.snaps = [guideId];
  }
}

function rotation(xf: Xform): string | undefined {
  const deg = round2(((xf.rot % 360) + 360) % 360);
  return deg ? `rotate(${deg}deg)` : undefined;
}

function cropRect(natural: { w: number; h: number } | undefined, crop: PictureNode["crop"]): Rect | undefined {
  if (!natural || !crop) return undefined;
  const { l, t, r, b } = crop;
  if (l < 0 || t < 0 || r < 0 || b < 0 || l + r >= 1 || t + b >= 1) return undefined;
  return {
    x: round2(l * natural.w),
    y: round2(t * natural.h),
    w: round2((1 - l - r) * natural.w),
    h: round2((1 - t - b) * natural.h),
  };
}

function arrowHead(kind: ArrowKind, tip: [number, number], from: [number, number], width: number): string {
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const size = Math.max(6, width * 3);
  const half = size / 2;
  const pt = (along: number, across: number) =>
    `${round2(tip[0] - ux * along - uy * across)} ${round2(tip[1] - uy * along + ux * across)}`;
  if (kind === "diamond" || kind === "oval") {
    return `M${pt(0, 0)}L${pt(half, half)}L${pt(size, 0)}L${pt(half, -half)}Z`;
  }
  const notch = kind === "stealth" ? size * 0.65 : size;
  return `M${pt(0, 0)}L${pt(size, half)}L${pt(notch, 0)}L${pt(size, -half)}Z`;
}

export interface EmitResult {
  layers: Layer[];
  height: number;
  /** Slides left out because of the layer budget. */
  droppedSlides: number;
  /** Layers cut from the first slide when it alone exceeds the budget. */
  droppedLayers: number;
}

/** Emits every slide, stopping before a slide that would exceed `maxLayers`. */
export function emitSlides(pres: Presentation, layout: SlideLayout, maxLayers: number): EmitResult {
  const layers: Layer[] = [];
  let top = layout.pad;
  let emitted = 0;
  let droppedLayers = 0;
  for (const slide of pres.slides) {
    const slideLayers = new SlideEmitter(slide, layout, top).emit();
    if (layers.length + slideLayers.length > maxLayers) {
      if (emitted > 0) break;
      // Parents always precede children, so a prefix of the first slide is self-consistent.
      droppedLayers = slideLayers.length - maxLayers;
      slideLayers.length = Math.max(1, maxLayers);
    }
    layers.push(...slideLayers);
    emitted++;
    top += layout.slideH + layout.pad;
    if (droppedLayers > 0) break;
  }
  return { layers, height: Math.ceil(top), droppedSlides: pres.slides.length - emitted, droppedLayers };
}
