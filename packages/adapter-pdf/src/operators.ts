/**
 * Walks a pdf.js operator list with a small graphics-state stack and reports,
 * in paint order and page CSS px:
 *  - vector shapes simple enough to redraw as SVG paths (rules, table lines, chart marks),
 *  - regions that must be revealed from the page bitmap instead (images, shadings,
 *    patterns, soft masks, paths under non-rectangular clips, oversized paths).
 *
 * Nothing here is needed for pixel correctness: anything the walker misses is
 * picked up later by the ink scan of the rendered bitmap.
 */

import {
  addPoint,
  type Edges,
  emptyEdges,
  expand,
  intersect,
  isEmpty,
  type Matrix,
  matrixScale,
  multiply,
  toMatrix,
  transformBox,
  union,
} from "./geometry";

const OP_NAMES = [
  "save",
  "restore",
  "transform",
  "setLineWidth",
  "setLineCap",
  "setLineJoin",
  "setDash",
  "setGState",
  "setStrokeRGBColor",
  "setFillRGBColor",
  "setStrokeTransparent",
  "setFillTransparent",
  "setStrokeColorN",
  "setFillColorN",
  "constructPath",
  "clip",
  "eoClip",
  "stroke",
  "closeStroke",
  "fill",
  "eoFill",
  "fillStroke",
  "eoFillStroke",
  "closeFillStroke",
  "closeEOFillStroke",
  "paintFormXObjectBegin",
  "paintFormXObjectEnd",
  "beginGroup",
  "endGroup",
  "paintImageXObject",
  "paintInlineImageXObject",
  "paintImageMaskXObject",
  "paintSolidColorImageMask",
  "paintImageXObjectRepeat",
  "paintImageMaskXObjectRepeat",
  "paintImageMaskXObjectGroup",
  "paintInlineImageXObjectGroup",
  "shadingFill",
  "beginAnnotation",
  "endAnnotation",
] as const;

/** Operator codes the walker understands; pass pdf.js `OPS`. */
export type PdfOps = Readonly<Record<(typeof OP_NAMES)[number], number>>;

/** Path commands inside `constructPath` data. Internal to pdf.js (`DrawOPS`), pinned with pdfjs-dist 6.5.438. */
export const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

/** Same shape as pdf.js `PDFOperatorList`. */
export interface OperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

/** A path redrawn as an SVG path layer. `cmds` uses {@link DRAW} codes with page CSS px coordinates. */
export interface VectorShape {
  order: number;
  cmds: number[];
  /** Only move/line/close commands. */
  straight: boolean;
  segments: number;
  edges: Edges;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  attrs: Record<string, string>;
  /** Set when a rectangular clip cuts the path. */
  clip?: Edges;
}

/** Something to reveal from the page bitmap. */
export interface PaintRegion {
  order: number;
  kind: "image" | "vector";
  edges: Edges;
}

export interface PaintScan {
  shapes: VectorShape[];
  regions: PaintRegion[];
  /** False when the list was too long or malformed and the walk stopped early. */
  complete: boolean;
}

export interface WalkOptions {
  /** CSS viewport transform of the page (pdf.js `viewport.transform`). */
  transform: Matrix;
  width: number;
  height: number;
  /** Thinnest stroke worth drawing, CSS px (one device pixel). */
  minStroke: number;
  /** Stop and report incomplete beyond this many operators. Default 150000. */
  maxOperators?: number;
  /** Paths with more segments become bitmap regions. Default 256. */
  maxSegments?: number;
  /** Further shapes become bitmap regions. Default 600. */
  maxShapes?: number;
}

interface GState {
  ctm: Matrix;
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  dash: number[];
  dashPhase: number;
  stroke: string | null;
  fill: string | null;
  strokeAlpha: number;
  fillAlpha: number;
  strokePattern: boolean;
  fillPattern: boolean;
  /** Soft mask, blend mode or transfer function: only the bitmap is faithful. */
  effects: boolean;
  clip: Edges;
  /** The clip is exactly `clip` (an intersection of axis-aligned rectangles). */
  clipIsRect: boolean;
}

interface Paint {
  stroke: boolean;
  fill: boolean;
  close: boolean;
  evenOdd: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;
const CAPS = ["butt", "round", "square"];
const JOINS = ["miter", "round", "bevel"];

/** Returns the table when pdf.js still exposes every operator the walker needs. */
export function checkOps(ops: Readonly<Record<string, number>>): PdfOps | null {
  return OP_NAMES.every((n) => typeof ops[n] === "number") ? (ops as PdfOps) : null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function paintOf(ops: PdfOps, op: number): Paint | null {
  switch (op) {
    case ops.stroke:
      return { stroke: true, fill: false, close: false, evenOdd: false };
    case ops.closeStroke:
      return { stroke: true, fill: false, close: true, evenOdd: false };
    case ops.fill:
      return { stroke: false, fill: true, close: false, evenOdd: false };
    case ops.eoFill:
      return { stroke: false, fill: true, close: false, evenOdd: true };
    case ops.fillStroke:
      return { stroke: true, fill: true, close: false, evenOdd: false };
    case ops.eoFillStroke:
      return { stroke: true, fill: true, close: false, evenOdd: true };
    case ops.closeFillStroke:
      return { stroke: true, fill: true, close: true, evenOdd: false };
    case ops.closeEOFillStroke:
      return { stroke: true, fill: true, close: true, evenOdd: true };
    default:
      return null;
  }
}

interface Decoded {
  cmds: number[];
  segments: number;
  straight: boolean;
  edges: Edges;
}

/** Transforms DrawOPS path data into page CSS px; null on unknown commands or too many segments. */
function decodePath(data: ArrayLike<number>, m: Matrix, maxSegments: number): Decoded | null {
  const cmds: number[] = [];
  const edges = emptyEdges();
  let segments = 0;
  let straight = true;
  const point = (x: unknown, y: unknown): void => {
    const px = num(x, Number.NaN);
    const py = num(y, Number.NaN);
    const tx = m[0] * px + m[2] * py + m[4];
    const ty = m[1] * px + m[3] * py + m[5];
    cmds.push(tx, ty);
    addPoint(edges, tx, ty);
  };
  for (let i = 0; i < data.length; ) {
    const code = data[i++];
    cmds.push(code as number);
    switch (code) {
      case DRAW.moveTo:
        point(data[i++], data[i++]);
        break;
      case DRAW.lineTo:
        point(data[i++], data[i++]);
        segments++;
        break;
      case DRAW.curveTo:
        point(data[i++], data[i++]);
        point(data[i++], data[i++]);
        point(data[i++], data[i++]);
        segments++;
        straight = false;
        break;
      case DRAW.quadraticCurveTo:
        point(data[i++], data[i++]);
        point(data[i++], data[i++]);
        segments++;
        straight = false;
        break;
      case DRAW.closePath:
        break;
      default:
        return null;
    }
    if (segments > maxSegments) return null;
  }
  if (cmds.some((v) => !Number.isFinite(v))) return null;
  return { cmds, segments, straight, edges };
}

/** True when decoded commands outline one axis-aligned rectangle. */
function isAxisRect(d: Decoded): boolean {
  const pts: [number, number][] = [];
  for (let i = 0; i < d.cmds.length; ) {
    const code = d.cmds[i++];
    if (code === DRAW.moveTo || code === DRAW.lineTo) {
      if (code === DRAW.moveTo && pts.length > 0) return false;
      pts.push([d.cmds[i++] as number, d.cmds[i++] as number]);
    } else if (code !== DRAW.closePath) return false;
  }
  if (pts.length === 5) pts.pop();
  if (pts.length !== 4) return false;
  const eps = 0.01;
  return pts.every(([x, y], k) => {
    const [nx, ny] = pts[(k + 1) % 4] as [number, number];
    return Math.abs(nx - x) < eps || Math.abs(ny - y) < eps;
  });
}

function isAxisAligned(m: Matrix): boolean {
  const eps = 1e-6;
  return (Math.abs(m[1]) < eps && Math.abs(m[2]) < eps) || (Math.abs(m[0]) < eps && Math.abs(m[3]) < eps);
}

function contains(outer: Edges, inner: Edges): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;
}

function unitSquare(m: Matrix): Edges {
  return transformBox(m, 0, 0, 1, 1);
}

/** Collects vector shapes and bitmap regions from an operator list. Never throws on malformed input. */
export function walkOperators(list: OperatorList, ops: PdfOps, opts: WalkOptions): PaintScan {
  const maxOperators = opts.maxOperators ?? 150_000;
  const maxSegments = opts.maxSegments ?? 256;
  const maxShapes = opts.maxShapes ?? 600;
  const page: Edges = { x0: 0, y0: 0, x1: opts.width, y1: opts.height };
  const shapes: VectorShape[] = [];
  const regions: PaintRegion[] = [];
  const count = Math.min(list.fnArray.length, list.argsArray.length);
  if (count > maxOperators) return { shapes, regions, complete: false };

  let gs: GState = {
    ctm: opts.transform,
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    dash: [],
    dashPhase: 0,
    stroke: "#000000",
    fill: "#000000",
    strokeAlpha: 1,
    fillAlpha: 1,
    strokePattern: false,
    fillPattern: false,
    effects: false,
    clip: page,
    clipIsRect: true,
  };
  const stack: GState[] = [];
  let pendingClip = false;
  let inAnnotation = false;
  let order = 0;

  const save = () => stack.push({ ...gs, dash: gs.dash.slice() });
  const restore = () => {
    gs = stack.pop() ?? gs;
  };
  const clipTo = (edges: Edges, exact: boolean) => {
    gs.clip = intersect(gs.clip, edges);
    gs.clipIsRect = gs.clipIsRect && exact;
  };
  const region = (kind: PaintRegion["kind"], edges: Edges) => {
    const visible = intersect(edges, gs.clip);
    if (!isEmpty(visible)) regions.push({ order: order++, kind, edges: visible });
  };

  /** Intersects the clip with a form or group bbox `[x0, y0, x1, y1]` given in the space of `m`. */
  const clipToBox = (m: Matrix, bbox: unknown) => {
    const b = Array.isArray(bbox) && bbox.length >= 4 ? bbox.slice(0, 4).map((v) => num(v, Number.NaN)) : null;
    if (!b?.every(Number.isFinite)) return;
    const [x0, y0, x1, y1] = b as [number, number, number, number];
    clipTo(transformBox(m, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)), isAxisAligned(m));
  };

  const paintPath = (paint: Paint, data: ArrayLike<number>, minMax: ArrayLike<number>) => {
    const strokeOn = paint.stroke && gs.strokeAlpha > 0 && (gs.strokePattern || gs.stroke !== null);
    const fillOn = paint.fill && gs.fillAlpha > 0 && (gs.fillPattern || gs.fill !== null);
    if (!strokeOn && !fillOn) return;
    const scale = matrixScale(gs.ctm);
    const strokeWidth = Math.max(gs.lineWidth * scale, opts.minStroke);
    const box = transformBox(gs.ctm, num(minMax[0], 0), num(minMax[1], 0), num(minMax[2], 0), num(minMax[3], 0));
    const painted = strokeOn ? expand(box, strokeWidth / 2) : box;
    const visible = intersect(painted, gs.clip);
    if (isEmpty(visible)) return;
    const pattern = (strokeOn && gs.strokePattern) || (fillOn && gs.fillPattern);
    const cut = !contains(gs.clip, painted);
    const decoded = pattern || gs.effects || (cut && !gs.clipIsRect) ? null : decodePath(data, gs.ctm, maxSegments);
    if (!decoded || shapes.length >= maxShapes) {
      region("vector", visible);
      return;
    }
    if (paint.close) decoded.cmds.push(DRAW.closePath);
    const attrs: Record<string, string> = {};
    const shape: VectorShape = {
      order: order++,
      cmds: decoded.cmds,
      straight: decoded.straight,
      segments: decoded.segments,
      edges: visible,
      attrs,
      fill: fillOn ? (gs.fill as string) : "none",
    };
    if (fillOn && gs.fillAlpha < 1) attrs["fill-opacity"] = String(gs.fillAlpha);
    if (fillOn && paint.evenOdd) attrs["fill-rule"] = "evenodd";
    if (strokeOn) {
      shape.stroke = gs.stroke as string;
      shape.strokeWidth = strokeWidth;
      if (gs.strokeAlpha < 1) attrs["stroke-opacity"] = String(gs.strokeAlpha);
      if (gs.lineCap) attrs["stroke-linecap"] = CAPS[gs.lineCap] ?? "butt";
      if (gs.lineJoin) attrs["stroke-linejoin"] = JOINS[gs.lineJoin] ?? "miter";
      if (gs.dash.some((d) => d > 0)) {
        attrs["stroke-dasharray"] = gs.dash.map((d) => +(d * scale).toFixed(2)).join(" ");
        if (gs.dashPhase) attrs["stroke-dashoffset"] = String(+(gs.dashPhase * scale).toFixed(2));
      }
    }
    if (cut) shape.clip = gs.clip;
    shapes.push(shape);
  };

  const constructPath = (args: unknown[]) => {
    const op = num(args[0], -1);
    const data = (args[1] as ArrayLike<ArrayLike<number> | null> | undefined)?.[0] ?? null;
    const minMax = args[2] as ArrayLike<number> | null | undefined;
    const paint = paintOf(ops, op);
    if (paint && data && minMax) paintPath(paint, data, minMax);
    if (!pendingClip) return;
    pendingClip = false;
    if (!data || !minMax) {
      clipTo({ x0: 0, y0: 0, x1: 0, y1: 0 }, true);
      return;
    }
    const box = transformBox(gs.ctm, num(minMax[0], 0), num(minMax[1], 0), num(minMax[2], 0), num(minMax[3], 0));
    const decoded = decodePath(data, gs.ctm, 64);
    clipTo(box, decoded !== null && isAxisRect(decoded));
  };

  /** Union of unit squares placed by `matrixAt(0..)` until it returns null (repeated or grouped images). */
  const imageGroup = (matrixAt: (k: number) => Matrix | null) => {
    let all = emptyEdges();
    for (let k = 0; k < 100_000; k++) {
      const m = matrixAt(k);
      if (!m) break;
      all = union(all, unitSquare(multiply(gs.ctm, m)));
    }
    if (!isEmpty(all)) region("image", all);
  };

  for (let i = 0; i < count; i++) {
    const fn = list.fnArray[i];
    const raw = list.argsArray[i];
    const args: unknown[] = Array.isArray(raw) ? raw : [];
    // Annotation appearances are drawn in their own coordinate setup; the ink scan picks them up instead.
    if (inAnnotation) {
      if (fn === ops.endAnnotation) inAnnotation = false;
      continue;
    }
    if (fn === ops.beginAnnotation) {
      inAnnotation = true;
      continue;
    }
    switch (fn) {
      case ops.save:
        save();
        break;
      case ops.restore:
        restore();
        break;
      case ops.transform: {
        const m = toMatrix(args);
        if (m) gs.ctm = multiply(gs.ctm, m);
        break;
      }
      case ops.setLineWidth:
        gs.lineWidth = Math.max(0, num(args[0], gs.lineWidth));
        break;
      case ops.setLineCap:
        gs.lineCap = num(args[0], 0);
        break;
      case ops.setLineJoin:
        gs.lineJoin = num(args[0], 0);
        break;
      case ops.setDash: {
        const dash = args[0];
        gs.dash = Array.isArray(dash) ? dash.map((d) => Math.max(0, num(d, 0))) : [];
        gs.dashPhase = num(args[1], 0);
        break;
      }
      case ops.setGState:
        applyGState(gs, args[0]);
        break;
      case ops.setStrokeRGBColor:
        gs.stroke = typeof args[0] === "string" && HEX.test(args[0]) ? args[0].toLowerCase() : null;
        gs.strokePattern = gs.stroke === null;
        break;
      case ops.setFillRGBColor:
        gs.fill = typeof args[0] === "string" && HEX.test(args[0]) ? args[0].toLowerCase() : null;
        gs.fillPattern = gs.fill === null;
        break;
      case ops.setStrokeTransparent:
        gs.stroke = null;
        gs.strokePattern = false;
        break;
      case ops.setFillTransparent:
        gs.fill = null;
        gs.fillPattern = false;
        break;
      case ops.setStrokeColorN:
        gs.strokePattern = true;
        break;
      case ops.setFillColorN:
        gs.fillPattern = true;
        break;
      case ops.clip:
      case ops.eoClip:
        pendingClip = true;
        break;
      case ops.constructPath:
        constructPath(args);
        break;
      case ops.paintFormXObjectBegin: {
        save();
        const m = toMatrix(args[0]);
        if (m) gs.ctm = multiply(gs.ctm, m);
        clipToBox(gs.ctm, args[1]);
        break;
      }
      case ops.beginGroup: {
        // The group matrix only places the group bbox; its content is transformed by the form that follows.
        save();
        const group = (args[0] ?? {}) as { matrix?: unknown; bbox?: unknown; smask?: unknown; knockout?: unknown };
        const m = toMatrix(group.matrix);
        clipToBox(m ? multiply(gs.ctm, m) : gs.ctm, group.bbox);
        if (group.smask || group.knockout || gs.fillAlpha < 1) gs.effects = true;
        break;
      }
      case ops.paintFormXObjectEnd:
      case ops.endGroup:
        restore();
        break;
      case ops.paintImageXObject:
      case ops.paintInlineImageXObject:
      case ops.paintImageMaskXObject:
      case ops.paintSolidColorImageMask:
        region("image", unitSquare(gs.ctm));
        break;
      case ops.paintImageXObjectRepeat: {
        const sx = num(args[1], 1);
        const sy = num(args[2], 1);
        const pos = args[3] as ArrayLike<number> | undefined;
        imageGroup((k) =>
          pos && 2 * k + 1 < pos.length ? [sx, 0, 0, sy, num(pos[2 * k], 0), num(pos[2 * k + 1], 0)] : null,
        );
        break;
      }
      case ops.paintImageMaskXObjectRepeat: {
        const [, a, b, c, d, pos] = args as [
          unknown,
          unknown,
          unknown,
          unknown,
          unknown,
          ArrayLike<number> | undefined,
        ];
        imageGroup((k) =>
          pos && 2 * k + 1 < pos.length
            ? [num(a, 1), num(b, 0), num(c, 0), num(d, 1), num(pos[2 * k], 0), num(pos[2 * k + 1], 0)]
            : null,
        );
        break;
      }
      case ops.paintImageMaskXObjectGroup:
      case ops.paintInlineImageXObjectGroup: {
        const items = (fn === ops.paintImageMaskXObjectGroup ? args[0] : args[1]) as unknown;
        const list = Array.isArray(items) ? items : [];
        imageGroup((k) => toMatrix((list[k] as { transform?: unknown } | undefined)?.transform));
        break;
      }
      case ops.shadingFill:
        region("vector", gs.clip);
        break;
      default:
        break;
    }
  }
  return { shapes, regions, complete: true };
}

function applyGState(gs: GState, states: unknown): void {
  if (!Array.isArray(states)) return;
  for (const entry of states) {
    if (!Array.isArray(entry)) continue;
    const [key, value] = entry as [unknown, unknown];
    switch (key) {
      case "LW":
        gs.lineWidth = Math.max(0, num(value, gs.lineWidth));
        break;
      case "LC":
        gs.lineCap = num(value, gs.lineCap);
        break;
      case "LJ":
        gs.lineJoin = num(value, gs.lineJoin);
        break;
      case "D":
        if (Array.isArray(value)) {
          const [dash, phase] = value as [unknown, unknown];
          gs.dash = Array.isArray(dash) ? dash.map((d) => Math.max(0, num(d, 0))) : [];
          gs.dashPhase = num(phase, 0);
        }
        break;
      case "CA":
        gs.strokeAlpha = Math.min(1, Math.max(0, num(value, 1)));
        break;
      case "ca":
        gs.fillAlpha = Math.min(1, Math.max(0, num(value, 1)));
        break;
      case "SMask":
      case "TR":
        if (value) gs.effects = true;
        break;
      case "BM":
        if (value !== "source-over") gs.effects = true;
        break;
      default:
        break;
    }
  }
}

/** Formats decoded commands as SVG path data, shifted into stage coordinates. */
export function toPathData(cmds: readonly number[], dx: number, dy: number): string {
  const f = (v: number) => String(+v.toFixed(2));
  let d = "";
  for (let i = 0; i < cmds.length; ) {
    const code = cmds[i++];
    const pt = () => `${f((cmds[i++] as number) + dx)} ${f((cmds[i++] as number) + dy)}`;
    switch (code) {
      case DRAW.moveTo:
        d += `M${pt()}`;
        break;
      case DRAW.lineTo:
        d += `L${pt()}`;
        break;
      case DRAW.curveTo:
        d += `C${pt()} ${pt()} ${pt()}`;
        break;
      case DRAW.quadraticCurveTo:
        d += `Q${pt()} ${pt()}`;
        break;
      default:
        d += "Z";
        break;
    }
  }
  return d;
}
