// Small, dependency-free packaging helpers for the sample generators of examples/odf, examples/epub
// and examples/ofd: a ZIP writer (stored or deflated entries, fixed timestamps so output is
// reproducible) and a PNG encoder for procedurally drawn artwork.

import { crc32, deflateRawSync, deflateSync } from "node:zlib";

/** DOS date/time of 2026-01-01 00:00, so archives are byte-identical between runs. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

/**
 * Builds a ZIP archive.
 * @param {{ name: string, data: string | Uint8Array, store?: boolean }[]} entries In archive order.
 * @returns {Buffer}
 */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.from(entry.data);
    const method = entry.store ? 0 : 8;
    const body = method === 0 ? raw : deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const common = [
      u16(20),
      u16(0x0800),
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(body.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
    ];
    const local = Buffer.concat([u32(0x04034b50), ...common, name, body]);
    centrals.push(
      Buffer.concat([u32(0x02014b50), u16(20), ...common, u16(0), u16(0), u16(0), u32(0), u32(offset), name]),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, directory, end]);
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  return Buffer.concat([u32be(data.length), t, data, u32be(crc32(Buffer.concat([t, data])))]);
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

/**
 * Encodes an RGB image as PNG.
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => [number, number, number]} pixel Colour of each pixel, 0..255.
 * @returns {Buffer}
 */
export function png(width, height, pixel) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      rows[row + 1 + x * 3] = r;
      rows[row + 2 + x * 3] = g;
      rows[row + 3 + x * 3] = b;
    }
  }
  const header = Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (c) => [
  Number.parseInt(c.slice(1, 3), 16),
  Number.parseInt(c.slice(3, 5), 16),
  Number.parseInt(c.slice(5, 7), 16),
];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/**
 * Our own "woven threads" artwork: diagonal warp and weft bands in brand colours over a soft
 * gradient. Deterministic for a given size and palette.
 * @param {number} width
 * @param {number} height
 * @param {string[]} colors Hex colours: background start, background end, thread A, thread B.
 */
export function weave(width, height, colors = ["#EEF0FF", "#FFF4EC", "#5B5BF7", "#FF6B5B"]) {
  const [bg0, bg1, a, b] = colors.map(hex);
  return png(width, height, (x, y) => {
    const base = mix(bg0, bg1, (x + y) / (width + height));
    const u = (x + y) % 28;
    const v = (x - y + 1000) % 28;
    const warp = u < 6;
    const weft = v < 6;
    if (warp && weft) return (Math.floor((x + y) / 28) + Math.floor((x - y + 1000) / 28)) & 1 ? a : b;
    if (warp) return mix(base, a, 0.85);
    if (weft) return mix(base, b, 0.85);
    return base;
  });
}
