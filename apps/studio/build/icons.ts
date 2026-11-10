import { deflateSync } from "node:zlib";
import {
  type Cubic,
  MARK_BG,
  MARK_CURSOR,
  MARK_CURSOR_COLOR,
  MARK_CURSOR_OUTLINE,
  MARK_PAPER,
  MARK_SIZE,
  MARK_STRAND_WIDTH,
  MARK_STRANDS,
  type Pt,
} from "../src/ui/mark";

/**
 * Rasterizes the Studio mark (src/ui/mark.ts) into PNG app icons at build time, with no image
 * dependencies: shapes are sampled on a sub-pixel grid and written with node:zlib.
 */

type Rgb = readonly [number, number, number];
type Segment = readonly [number, number, number, number];

function hex(color: string): Rgb {
  const v = Number.parseInt(color.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function flatten(cubic: Cubic, steps = 24): Pt[] {
  const [p0, p1, p2, p3] = cubic;
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

function segmentsOf(points: readonly Pt[], closed: boolean): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b) out.push([a[0], a[1], b[0], b[1]]);
  }
  return out;
}

function insidePolygon(x: number, y: number, polygon: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function insideRoundedRect(x: number, y: number): boolean {
  const { x: rx, y: ry, size, radius } = MARK_BG;
  if (x < rx || y < ry || x > rx + size || y > ry + size) return false;
  const cx = Math.max(rx + radius, Math.min(x, rx + size - radius));
  const cy = Math.max(ry + radius, Math.min(y, ry + size - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

const STRANDS = MARK_STRANDS.map((strand) =>
  segmentsOf(
    strand.flatMap((c, i) => (i === 0 ? flatten(c) : flatten(c).slice(1))),
    false,
  ),
);
const CURSOR_EDGES = segmentsOf(MARK_CURSOR, true);
const BG = hex(MARK_BG.color);
const PAPER = hex(MARK_PAPER);
const ACCENT = hex(MARK_CURSOR_COLOR);

export interface IconOptions {
  /** Full-bleed square with the artwork inside the 80 % safe zone (`purpose: "maskable"`). */
  maskable?: boolean;
}

/** A square sub-pixel sample grid over the icon, with conversions to and from mark units (0..32). */
class SampleGrid {
  readonly n: number;
  private readonly unit: number;
  private readonly scale: number;
  private readonly centre = MARK_SIZE / 2;

  constructor(
    size: number,
    readonly perPixel: number,
    maskable: boolean,
  ) {
    this.n = size * perPixel;
    this.unit = MARK_SIZE / size;
    // Maskable icons scale the artwork to 80 % around the centre; launchers crop the rest.
    this.scale = maskable ? 0.8 : 1;
  }

  /** Mark coordinate of sample index `i`. */
  toMark(i: number): number {
    return this.centre + (((i + 0.5) / this.perPixel) * this.unit - this.centre) / this.scale;
  }

  /** Sample index range covering mark coordinates `lo..hi`. */
  range(lo: number, hi: number): [number, number] {
    const index = (m: number) => ((this.centre + (m - this.centre) * this.scale) / this.unit) * this.perPixel - 0.5;
    return [Math.max(0, Math.floor(index(lo))), Math.min(this.n - 1, Math.ceil(index(hi)))];
  }
}

/** Marks every sample within `radius` of a segment; only each segment's bounding box is visited. */
function stroke(mask: Uint8Array, grid: SampleGrid, segments: readonly Segment[], radius: number): void {
  const r2 = radius * radius;
  for (const [ax, ay, bx, by] of segments) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const [i0, i1] = grid.range(Math.min(ax, bx) - radius, Math.max(ax, bx) + radius);
    const [j0, j1] = grid.range(Math.min(ay, by) - radius, Math.max(ay, by) + radius);
    for (let j = j0; j <= j1; j++) {
      const y = grid.toMark(j);
      for (let i = i0; i <= i1; i++) {
        const x = grid.toMark(i);
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
        const px = ax + t * dx - x;
        const py = ay + t * dy - y;
        if (px * px + py * py <= r2) mask[j * grid.n + i] = 1;
      }
    }
  }
}

/** Marks every sample inside the polygon, visiting only its bounding box. */
function fill(mask: Uint8Array, grid: SampleGrid, polygon: readonly Pt[]): void {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const [i0, i1] = grid.range(Math.min(...xs), Math.max(...xs));
  const [j0, j1] = grid.range(Math.min(...ys), Math.max(...ys));
  for (let j = j0; j <= j1; j++) {
    const y = grid.toMark(j);
    for (let i = i0; i <= i1; i++) {
      if (insidePolygon(grid.toMark(i), y, polygon)) mask[j * grid.n + i] = 1;
    }
  }
}

/** RGBA pixels of the mark at `size` px. */
export function rasterizeMark(size: number, options: IconOptions = {}): Uint8Array {
  const maskable = options.maskable ?? false;
  const grid = new SampleGrid(size, size <= 192 ? 4 : 3, maskable);
  const n = grid.n;
  // Layers in paint order: strands, cursor fill, cursor outline.
  const strands = new Uint8Array(n * n);
  const cursor = new Uint8Array(n * n);
  const outline = new Uint8Array(n * n);
  for (const strand of STRANDS) stroke(strands, grid, strand, MARK_STRAND_WIDTH / 2);
  fill(cursor, grid, MARK_CURSOR);
  stroke(outline, grid, CURSOR_EDGES, MARK_CURSOR_OUTLINE / 2);

  const per = grid.perPixel;
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < per; sy++) {
        const j = py * per + sy;
        for (let sx = 0; sx < per; sx++) {
          const i = px * per + sx;
          if (!maskable && !insideRoundedRect(grid.toMark(i), grid.toMark(j))) continue;
          const k = j * n + i;
          const color = outline[k] ? PAPER : cursor[k] ? ACCENT : strands[k] ? PAPER : BG;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const o = (py * size + px) * 4;
      if (a > 0) {
        pixels[o] = Math.round(r / a);
        pixels[o + 1] = Math.round(g / a);
        pixels[o + 2] = Math.round(b / a);
      }
      pixels[o + 3] = Math.round((a / (per * per)) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes RGBA pixels as a PNG file. */
export function encodePng(pixels: Uint8Array, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** The mark as a PNG icon. */
export function markPng(size: number, options: IconOptions = {}): Buffer {
  return encodePng(rasterizeMark(size, options), size, size);
}
