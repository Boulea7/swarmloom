import { describe, expect, it } from "vitest";
import { createKernel, imageAdapter, probeImage, smoothPath, sniffFormat } from "../src/index";
import { placeImage } from "../src/layers";

const kernel = createKernel();
const ctx = { document, width: 800, theme: "light" as const };

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  return Uint8Array.from(out);
}

const be32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const le16 = (v: number): number[] => [v & 255, (v >>> 8) & 255];
const le24 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255];

/** White square canvas with a dark filled square in the middle. */
function squareImage(size: number, from: number, to: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = from; y < to; y++) {
    for (let x = from; x < to; x++) rgba.set([30, 40, 90, 255], (y * size + x) * 4);
  }
  return rgba;
}

describe("Ramer-Douglas-Peucker simplification", () => {
  it("collapses collinear points to the endpoints", () => {
    expect(kernel.simplify([0, 0, 1, 1, 2, 2, 3, 3, 10, 10], 0.5)).toEqual([0, 0, 10, 10]);
  });

  it("keeps corners and drops points within epsilon", () => {
    const l = [0, 0, 5, 0.4, 10, 0, 10, 5, 10, 10];
    expect(kernel.simplify(l, 0.5)).toEqual([0, 0, 10, 0, 10, 10]);
    // A deviation of exactly epsilon is dropped; anything beyond it is kept.
    expect(kernel.simplify([0, 0, 5, 1, 10, 0], 1)).toEqual([0, 0, 10, 0]);
    expect(kernel.simplify([0, 0, 5, 1.01, 10, 0], 1)).toEqual([0, 0, 5, 1.01, 10, 0]);
  });

  it("handles closed loops and tiny inputs", () => {
    const loop = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
    expect(kernel.simplify(loop, 1)).toEqual(loop);
    expect(kernel.simplify([1, 2], 1)).toEqual([1, 2]);
    expect(kernel.simplify([1, 2, 3, 4], 1)).toEqual([1, 2, 3, 4]);
  });
});

describe("edge pipeline", () => {
  it("links a straight run of edge pixels into one polyline", () => {
    const w = 16;
    const edges = new Uint8Array(w * 8);
    for (let x = 2; x <= 12; x++) edges[5 * w + x] = 1;
    const lines = kernel.link(edges, w, 8);
    expect(lines).toHaveLength(1);
    const line = lines[0] as number[];
    expect(line).toHaveLength(22);
    const ends = [line.slice(0, 2), line.slice(-2)].map((p) => p.join(",")).sort();
    expect(ends).toEqual(["12,5", "2,5"]);
  });

  it("outlines a square, tiles the frame and is deterministic", () => {
    const opts = { maxStrokes: 20, minStrokeLength: 4, epsilon: 1, maxTiles: 40, minTile: 4, backgroundLuma: 250 };
    const rgba = squareImage(64, 20, 44);
    const a = kernel.analyze(rgba, 64, 64, opts);
    expect(a).toEqual(kernel.analyze(rgba, 64, 64, opts));
    expect(a.hasAlpha).toBe(false);
    expect(a.strokes.length).toBeGreaterThan(0);
    expect(a.strokes.length).toBeLessThanOrEqual(20);
    const total = a.strokes.reduce((s, k) => s + k.length, 0);
    // The outline is about 4 * 24 px long; the sketch should cover most of it, and nothing else.
    expect(total).toBeGreaterThan(70);
    expect(total).toBeLessThan(130);
    for (const s of a.strokes) {
      expect(s.strength).toBeGreaterThan(0);
      expect(s.strength).toBeLessThanOrEqual(1);
      for (let i = 0; i < s.points.length; i += 2) {
        const [x, y] = [s.points[i] as number, s.points[i + 1] as number];
        const nearEdge = Math.min(Math.abs(x - 20), Math.abs(x - 43), Math.abs(y - 20), Math.abs(y - 43));
        expect(nearEdge).toBeLessThanOrEqual(2);
      }
    }
    // Quadtree leaves partition the frame, bigger blocks first, within the cap.
    expect(a.tiles.length).toBeLessThanOrEqual(40);
    expect(a.tiles.reduce((s, t) => s + t.w * t.h, 0)).toBe(64 * 64);
    expect(a.tiles.every((t) => /^#[0-9a-f]{6}$/.test(t.colour))).toBe(true);
    expect(a.tiles.some((t) => t.colour === "#ffffff")).toBe(true);
  });

  it("finds nothing in a flat image", () => {
    const flat = new Uint8ClampedArray(32 * 32 * 4).fill(128);
    const opts = { maxStrokes: 20, minStrokeLength: 4, epsilon: 1, maxTiles: 40, minTile: 4, backgroundLuma: 250 };
    const a = kernel.analyze(flat, 32, 32, opts);
    expect(a.strokes).toEqual([]);
    expect(a.tiles).toEqual([{ x: 0, y: 0, w: 32, h: 32, colour: "#808080", detail: 0 }]);
  });
});

describe("image headers", () => {
  it("reads PNG size and APNG animation", () => {
    const ihdr = bytes(
      [0x89],
      "PNG",
      [13, 10, 26, 10],
      be32(13),
      "IHDR",
      be32(300),
      be32(200),
      [8, 6, 0, 0, 0],
      [0, 0, 0, 0],
    );
    expect(probeImage(ihdr)).toEqual({ format: "png", width: 300, height: 200, animated: false });
    const apng = bytes(Array.from(ihdr), be32(8), "acTL", be32(2), be32(0), [0, 0, 0, 0], be32(0), "IDAT");
    expect(probeImage(apng)?.animated).toBe(true);
  });

  it("reads WebP, JPEG and GIF headers", () => {
    const vp8x = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8X", [10, 0, 0, 0], [0x02, 0, 0, 0], le24(639), le24(479));
    expect(probeImage(vp8x)).toEqual({ format: "webp", width: 640, height: 480, animated: true });
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0], [0, 4, 0, 0], [0xff, 0xc0, 0, 17, 8], [0, 120], [0, 160], [3, 0, 0]);
    expect(probeImage(jpeg)).toEqual({ format: "jpeg", width: 160, height: 120, animated: false });
    const frame = [0x2c, ...le16(0), ...le16(0), ...le16(3), ...le16(2), 0, 2, 1, 0x44, 0];
    const still = bytes("GIF89a", le16(3), le16(2), [0, 0, 0], frame, [0x3b]);
    expect(probeImage(still)).toEqual({ format: "gif", width: 3, height: 2, animated: false });
    const ext = [0x21, 0xf9, 4, 0, 10, 0, 0, 0];
    const anim = bytes("GIF89a", le16(3), le16(2), [0, 0, 0], ext, frame, ext, frame, [0x3b]);
    expect(probeImage(anim)?.animated).toBe(true);
  });

  it("rejects unknown bytes", () => {
    expect(sniffFormat(bytes("<svg xmlns="))).toBeNull();
    expect(probeImage(new Uint8Array(4))).toBeNull();
  });
});

describe("layout helpers", () => {
  it("smooths polylines through midpoints", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([1, 2, 3, 4])).toBe("M1 2L3 4");
    expect(smoothPath([0, 0, 10, 0, 10, 10])).toBe("M0 0L5 0Q10 0 10 5L10 10");
  });

  it("fits the image to the stage width with upscale and height caps", () => {
    expect(placeImage({ w: 1600, h: 800 }, 800, 2, 4)).toEqual({
      world: { w: 800, h: 400 },
      rect: { x: 0, y: 0, w: 800, h: 400 },
    });
    expect(placeImage({ w: 100, h: 50 }, 800, 2, 4)).toEqual({
      world: { w: 800, h: 100 },
      rect: { x: 300, y: 0, w: 200, h: 100 },
    });
    expect(placeImage({ w: 100, h: 1000 }, 800, 2, 0.25)).toEqual({
      world: { w: 800, h: 200 },
      rect: { x: 390, y: 0, w: 20, h: 200 },
    });
  });
});

describe("imageAdapter input validation", () => {
  it("exposes metadata and sniffs image bytes", () => {
    expect(imageAdapter.id).toBe("image");
    expect(imageAdapter.extensions).toEqual(expect.arrayContaining(["png", "jpg", "webp", "gif", "avif"]));
    expect(imageAdapter.sniff?.(bytes("GIF89a", [0, 0, 0, 0]), "")).toBe(true);
    expect(imageAdapter.sniff?.(bytes("hello world!"), "")).toBe(false);
  });

  it("rejects missing input, unknown formats and oversized images", async () => {
    await expect(imageAdapter.load({}, ctx)).rejects.toThrow(/bytes or a URL/);
    await expect(imageAdapter.load({ bytes: bytes("not an image at all") }, ctx)).rejects.toThrow(
      /Unsupported image format/,
    );
    const huge = bytes(
      [0x89],
      "PNG",
      [13, 10, 26, 10],
      be32(13),
      "IHDR",
      be32(100_000),
      be32(100_000),
      [8, 6, 0, 0, 0],
    );
    await expect(imageAdapter.load({ bytes: huge }, ctx)).rejects.toThrow(/too large/);
    await expect(imageAdapter.load({ bytes: huge }, { ...ctx, width: 0 })).rejects.toThrow(/width/);
  });
});
