// Placeholder extension icons, generated when assets/brand has none: an indigo rounded square
// with a white pointer and a coral dot (SwarmLoom brand colours). PNG encoding via node:zlib only.
import { crc32, deflateSync } from "node:zlib";

const INDIGO = [0x5b, 0x5b, 0xf7];
const WHITE = [0xff, 0xff, 0xff];
const CORAL = [0xff, 0x4f, 0x7b];

/** Pointer outline in unit coordinates (original shape for SwarmLoom). */
const POINTER = [
  [0.3, 0.2],
  [0.3, 0.74],
  [0.42, 0.62],
  [0.51, 0.8],
  [0.59, 0.76],
  [0.5, 0.58],
  [0.67, 0.58],
];

/** @param {number} x @param {number} y @param {number[][]} poly */
function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = /** @type {[number, number]} */ (poly[i]);
    const [xj, yj] = /** @type {[number, number]} */ (poly[j]);
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** @param {number} x @param {number} y @param {number} r */
function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** @param {number} x @param {number} y */
function colourAt(x, y) {
  if (!inRoundedSquare(x, y, 0.22)) return null;
  if ((x - 0.73) ** 2 + (y - 0.28) ** 2 <= 0.1 ** 2) return CORAL;
  if (inPolygon(x, y, POINTER)) return WHITE;
  return INDIGO;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Renders the placeholder icon as an RGBA PNG (4x4 supersampled edges).
 * @param {number} size Edge length in pixels.
 * @returns {Buffer}
 */
export function placeholderIcon(size) {
  const samples = 4;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const c = colourAt((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size);
          if (!c) continue;
          r += c[0] ?? 0;
          g += c[1] ?? 0;
          b += c[2] ?? 0;
          covered++;
        }
      }
      const o = 1 + px * 4;
      if (covered > 0) {
        row[o] = Math.round(r / covered);
        row[o + 1] = Math.round(g / covered);
        row[o + 2] = Math.round(b / covered);
        row[o + 3] = Math.round((255 * covered) / (samples * samples));
      }
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
