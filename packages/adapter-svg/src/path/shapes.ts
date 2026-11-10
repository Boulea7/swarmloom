import { type PathSegment, parseNumberList } from "./parse";

/**
 * Basic shapes as normalised path segments, following the equivalent-path definitions of
 * SVG 2 (section 10): every shape starts where the specification says the stroke starts, so
 * dash patterns and pen tracing begin at the same point as in a browser.
 */

/** `rect` with optional rounded corners. `rx`/`ry` of `undefined` mean "auto". */
export function rectSegments(x: number, y: number, w: number, h: number, rx?: number, ry?: number): PathSegment[] {
  if (!(w > 0 && h > 0)) return [];
  let rxv = rx !== undefined && rx >= 0 ? rx : undefined;
  let ryv = ry !== undefined && ry >= 0 ? ry : undefined;
  if (rxv === undefined) rxv = ryv ?? 0;
  if (ryv === undefined) ryv = rxv;
  rxv = Math.min(rxv, w / 2);
  ryv = Math.min(ryv, h / 2);
  if (rxv <= 0 || ryv <= 0) {
    return [
      { type: "M", x, y },
      { type: "L", x: x + w, y },
      { type: "L", x: x + w, y: y + h },
      { type: "L", x, y: y + h },
      { type: "Z" },
    ];
  }
  const corner = (ex: number, ey: number): PathSegment => ({
    type: "A",
    rx: rxv,
    ry: ryv,
    rotation: 0,
    largeArc: false,
    sweep: true,
    x: ex,
    y: ey,
  });
  return [
    { type: "M", x: x + rxv, y },
    { type: "L", x: x + w - rxv, y },
    corner(x + w, y + ryv),
    { type: "L", x: x + w, y: y + h - ryv },
    corner(x + w - rxv, y + h),
    { type: "L", x: x + rxv, y: y + h },
    corner(x, y + h - ryv),
    { type: "L", x, y: y + ryv },
    corner(x + rxv, y),
    { type: "Z" },
  ];
}

/** `ellipse` (and `circle` with rx = ry) as four quarter arcs starting at (cx + rx, cy). */
export function ellipseSegments(cx: number, cy: number, rx: number, ry: number): PathSegment[] {
  if (!(rx > 0 && ry > 0)) return [];
  const arc = (x: number, y: number): PathSegment => ({
    type: "A",
    rx,
    ry,
    rotation: 0,
    largeArc: false,
    sweep: true,
    x,
    y,
  });
  return [
    { type: "M", x: cx + rx, y: cy },
    arc(cx, cy + ry),
    arc(cx - rx, cy),
    arc(cx, cy - ry),
    arc(cx + rx, cy),
    { type: "Z" },
  ];
}

export function lineSegments(x1: number, y1: number, x2: number, y2: number): PathSegment[] {
  return [
    { type: "M", x: x1, y: y1 },
    { type: "L", x: x2, y: y2 },
  ];
}

/** `polyline` / `polygon` from a flat coordinate list. */
export function polySegments(coords: readonly number[], closed: boolean): PathSegment[] {
  const n = Math.floor(coords.length / 2);
  if (n === 0) return [];
  const out: PathSegment[] = [{ type: "M", x: coords[0] ?? 0, y: coords[1] ?? 0 }];
  for (let i = 1; i < n; i++) out.push({ type: "L", x: coords[2 * i] ?? 0, y: coords[2 * i + 1] ?? 0 });
  if (closed) out.push({ type: "Z" });
  return out;
}

/**
 * Parses a `points` attribute. On malformed input the coordinates before the error are kept and an
 * odd trailing coordinate is dropped, as browsers do.
 */
export function parsePoints(value: string): number[] {
  const out = parseNumberList(value);
  if (out.length % 2 === 1) out.pop();
  return out;
}
