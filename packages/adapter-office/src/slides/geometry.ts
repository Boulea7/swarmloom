/**
 * Preset and custom DrawingML geometry -> boxes or SVG-ready path segments in local EMU space.
 * Arcs are converted to cubic Beziers so flips and offsets stay simple affine maps.
 */

import { attr, intAttr, kid, kids } from "../shared/xml";
import type { Geometry, PathSegment } from "./model";

type Pt = readonly [number, number];

function poly(points: readonly Pt[]): Geometry {
  const segments: PathSegment[] = points.map(([x, y], i) => ({ op: i === 0 ? "M" : "L", x, y }));
  segments.push({ op: "Z" });
  return { kind: "path", segments, closed: true };
}

/** Adjust values (`a:gd name="adj" fmla="val 25000"`) of a preset, by name. */
export function adjustValues(prstGeom: Element | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const gd of kids(kid(prstGeom, "avLst"), "gd")) {
    const name = attr(gd, "name");
    const m = /^val\s+(-?\d+)/.exec(attr(gd, "fmla") ?? "");
    if (name && m?.[1]) out[name] = Number(m[1]);
  }
  return out;
}

function arrow(w: number, h: number, a1: number, a2: number): Pt[] {
  const head = Math.min(w, (Math.min(w, h) * a2) / 100000);
  const half = (h * Math.min(a1, 100000)) / 200000;
  const y1 = h / 2 - half;
  const y2 = h / 2 + half;
  return [
    [0, y1],
    [w - head, y1],
    [w - head, 0],
    [w, h / 2],
    [w - head, h],
    [w - head, y2],
    [0, y2],
  ];
}

function star(w: number, h: number, points: number, inner: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    out.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]);
  }
  return out;
}

function regular(w: number, h: number, sides: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    out.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]);
  }
  return out;
}

/**
 * Geometry for a preset name at the given size (EMU). Unknown presets fall back to a rectangle,
 * which keeps the fill and text visible rather than dropping the shape.
 */
export function presetGeometry(prst: string, w: number, h: number, adj: Record<string, number>): Geometry {
  const m = Math.min(w, h);
  const a = (name: string, def: number) => adj[name] ?? def;
  switch (prst) {
    case "rect":
    case "flowChartProcess":
    case "snip1Rect":
    case "round1Rect":
      return { kind: "rect" };
    case "roundRect":
    case "flowChartAlternateProcess":
      return { kind: "roundRect", radius: (m * Math.min(a("adj", 16667), 50000)) / 100000 };
    case "flowChartTerminator":
      return { kind: "roundRect", radius: m / 2 };
    case "ellipse":
    case "flowChartConnector":
      return { kind: "ellipse" };
    case "triangle":
    case "flowChartExtract":
      return poly([
        [(w * a("adj", 50000)) / 100000, 0],
        [w, h],
        [0, h],
      ]);
    case "rtTriangle":
      return poly([
        [0, 0],
        [w, h],
        [0, h],
      ]);
    case "diamond":
    case "flowChartDecision":
      return poly([
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ]);
    case "parallelogram":
    case "flowChartInputOutput": {
      const o = Math.min(w, (m * a("adj", 25000)) / 100000);
      return poly([
        [o, 0],
        [w, 0],
        [w - o, h],
        [0, h],
      ]);
    }
    case "trapezoid": {
      const o = Math.min(w / 2, (m * a("adj", 25000)) / 100000);
      return poly([
        [0, h],
        [o, 0],
        [w - o, 0],
        [w, h],
      ]);
    }
    case "pentagon":
      return poly(regular(w, h, 5));
    case "hexagon": {
      const o = Math.min(w / 2, (m * a("adj", 25000)) / 100000);
      return poly([
        [o, 0],
        [w - o, 0],
        [w, h / 2],
        [w - o, h],
        [o, h],
        [0, h / 2],
      ]);
    }
    case "octagon": {
      const o = Math.min(w / 2, h / 2, (m * a("adj", 29289)) / 100000);
      return poly([
        [o, 0],
        [w - o, 0],
        [w, o],
        [w, h - o],
        [w - o, h],
        [o, h],
        [0, h - o],
        [0, o],
      ]);
    }
    case "homePlate": {
      const o = Math.min(w, (m * a("adj", 50000)) / 100000);
      return poly([
        [0, 0],
        [w - o, 0],
        [w, h / 2],
        [w - o, h],
        [0, h],
      ]);
    }
    case "chevron": {
      const o = Math.min(w, (m * a("adj", 50000)) / 100000);
      return poly([
        [0, 0],
        [w - o, 0],
        [w, h / 2],
        [w - o, h],
        [0, h],
        [o, h / 2],
      ]);
    }
    case "rightArrow":
      return poly(arrow(w, h, a("adj1", 50000), a("adj2", 50000)));
    case "leftArrow":
      return poly(arrow(w, h, a("adj1", 50000), a("adj2", 50000)).map(([x, y]) => [w - x, y] as Pt));
    case "downArrow":
      return poly(arrow(h, w, a("adj1", 50000), a("adj2", 50000)).map(([x, y]) => [y, x] as Pt));
    case "upArrow":
      return poly(arrow(h, w, a("adj1", 50000), a("adj2", 50000)).map(([x, y]) => [y, h - x] as Pt));
    case "plus":
    case "mathPlus": {
      const o = Math.min(w / 2, h / 2, (m * a("adj", 25000)) / 100000);
      return poly([
        [o, 0],
        [w - o, 0],
        [w - o, o],
        [w, o],
        [w, h - o],
        [w - o, h - o],
        [w - o, h],
        [o, h],
        [o, h - o],
        [0, h - o],
        [0, o],
        [o, o],
      ]);
    }
    case "star5":
      return poly(star(w, h, 5, 0.382));
    case "star4":
      return poly(star(w, h, 4, 0.25));
    case "star6":
      return poly(star(w, h, 6, 0.5));
    case "line":
    case "straightConnector1":
      return {
        kind: "line",
        segments: [
          { op: "M", x: 0, y: 0 },
          { op: "L", x: w, y: h },
        ],
      };
    case "bentConnector2":
      return {
        kind: "line",
        segments: [
          { op: "M", x: 0, y: 0 },
          { op: "L", x: w, y: 0 },
          { op: "L", x: w, y: h },
        ],
      };
    case "bentConnector3": {
      const x = (w * a("adj1", 50000)) / 100000;
      return {
        kind: "line",
        segments: [
          { op: "M", x: 0, y: 0 },
          { op: "L", x, y: 0 },
          { op: "L", x, y: h },
          { op: "L", x: w, y: h },
        ],
      };
    }
    case "curvedConnector3":
      return {
        kind: "line",
        segments: [
          { op: "M", x: 0, y: 0 },
          { op: "C", x1: w / 2, y1: 0, x2: w / 2, y2: h, x: w, y: h },
        ],
      };
    default:
      if (prst.includes("Connector")) return presetGeometry("line", w, h, adj);
      return { kind: "rect" };
  }
}

/** Appends Bezier segments approximating an elliptical arc (angles in degrees, clockwise). */
function arcTo(out: PathSegment[], cx: number, cy: number, rx: number, ry: number, start: number, sweep: number): Pt {
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 90));
  const delta = ((sweep / steps) * Math.PI) / 180;
  let a0 = (start * Math.PI) / 180;
  const k = (4 / 3) * Math.tan(delta / 4);
  let end: Pt = [cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)];
  for (let i = 0; i < steps; i++) {
    const a1 = a0 + delta;
    const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
    end = [cx + rx * c1, cy + ry * s1];
    out.push({
      op: "C",
      x1: cx + rx * (c0 - k * s0),
      y1: cy + ry * (s0 + k * c0),
      x2: cx + rx * (c1 + k * s1),
      y2: cy + ry * (s1 - k * c1),
      x: end[0],
      y: end[1],
    });
    a0 = a1;
  }
  return end;
}

/**
 * `a:custGeom` path list scaled to the shape size. Supports moveTo, lnTo, cubicBezTo, quadBezTo,
 * arcTo and close; guides (`a:gdLst`) are not evaluated, so only literal coordinates are used.
 */
export function customGeometry(custGeom: Element, w: number, h: number): Geometry | undefined {
  const segments: PathSegment[] = [];
  let closed = false;
  for (const pathEl of kids(kid(custGeom, "pathLst"), "path")) {
    const pw = intAttr(pathEl, "w", 0) || w;
    const ph = intAttr(pathEl, "h", 0) || h;
    const sx = pw ? w / pw : 1;
    const sy = ph ? h / ph : 1;
    const pt = (el: Element | undefined): Pt | undefined => {
      const x = Number(attr(el, "x"));
      const y = Number(attr(el, "y"));
      return Number.isFinite(x) && Number.isFinite(y) ? [x * sx, y * sy] : undefined;
    };
    let cur: Pt = [0, 0];
    for (const cmd of kids(pathEl)) {
      const pts = kids(cmd, "pt").map(pt);
      if (pts.some((p) => !p)) return undefined;
      const p = pts as Pt[];
      switch (cmd.localName) {
        case "moveTo":
        case "lnTo":
          if (!p[0]) return undefined;
          segments.push({ op: cmd.localName === "moveTo" ? "M" : "L", x: p[0][0], y: p[0][1] });
          cur = p[0];
          break;
        case "cubicBezTo":
          if (!p[0] || !p[1] || !p[2]) return undefined;
          segments.push({ op: "C", x1: p[0][0], y1: p[0][1], x2: p[1][0], y2: p[1][1], x: p[2][0], y: p[2][1] });
          cur = p[2];
          break;
        case "quadBezTo": {
          if (!p[0] || !p[1]) return undefined;
          const [qx, qy] = p[0];
          const [ex, ey] = p[1];
          segments.push({
            op: "C",
            x1: cur[0] + (2 / 3) * (qx - cur[0]),
            y1: cur[1] + (2 / 3) * (qy - cur[1]),
            x2: ex + (2 / 3) * (qx - ex),
            y2: ey + (2 / 3) * (qy - ey),
            x: ex,
            y: ey,
          });
          cur = p[1];
          break;
        }
        case "arcTo": {
          const rx = (Number(attr(cmd, "wR")) || 0) * sx;
          const ry = (Number(attr(cmd, "hR")) || 0) * sy;
          const st = (Number(attr(cmd, "stAng")) || 0) / 60000;
          const sw = (Number(attr(cmd, "swAng")) || 0) / 60000;
          const rad = (st * Math.PI) / 180;
          const cx = cur[0] - rx * Math.cos(rad);
          const cy = cur[1] - ry * Math.sin(rad);
          cur = arcTo(segments, cx, cy, rx, ry, st, sw);
          break;
        }
        case "close":
          segments.push({ op: "Z" });
          closed = true;
          break;
        default:
          break;
      }
    }
  }
  return segments.length > 1 ? { kind: "path", segments, closed } : undefined;
}
