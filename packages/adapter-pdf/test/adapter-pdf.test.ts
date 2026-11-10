import { describe, expect, it } from "vitest";
import { inkMap, residualInk } from "../src/coverage";
import type { Edges } from "../src/geometry";
import { createPdfAdapter, PdfAdapterError, pdfAdapter } from "../src/index";
import { mergeShapes } from "../src/layers";
import { DRAW, type PdfOps, type VectorShape, walkOperators } from "../src/operators";
import { bodySize, groupBlocks, groupLines, roleOf, toRuns } from "../src/text";

/** pdf.js 6.5 operator codes used by the synthetic lists below. */
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 2,
  setLineCap: 3,
  setLineJoin: 4,
  setDash: 6,
  setGState: 9,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  setStrokeTransparent: 92,
  setFillTransparent: 93,
  setStrokeColorN: 53,
  setFillColorN: 55,
  constructPath: 91,
  clip: 29,
  eoClip: 30,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
  paintSolidColorImageMask: 90,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
  paintImageMaskXObjectGroup: 84,
  paintInlineImageXObjectGroup: 87,
  shadingFill: 62,
  beginAnnotation: 80,
  endAnnotation: 81,
} satisfies PdfOps;

/** Page of 200 x 100 CSS px at scale 1: PDF y grows upwards, CSS y downwards. */
const frame = { transform: [1, 0, 0, -1, 0, 100] as const, scale: 1, width: 200, height: 100 };

const item = (str: string, x: number, y: number, size: number, width: number, extra: object = {}) => ({
  str,
  dir: "ltr",
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
  fontName: "f",
  hasEOL: false,
  ...extra,
});

describe("text grouping", () => {
  it("builds lines and blocks, joins split words, and tells headings from body text", () => {
    const items = [
      item("Title", 10, 80, 20, 50),
      { str: "", hasEOL: true, transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0, fontName: "f", dir: "ltr" },
      item("Body text", 10, 60, 10, 45),
      item("continues", 58, 60, 10, 40),
      item("line two", 10, 46, 10, 40),
      item("far right column", 150, 46, 10, 45),
      item("rotated", 190, 10, 8, 30, { transform: [0, 8, -8, 0, 190, 10] }),
      { type: "beginMarkedContent", id: "m1" },
      item("off page", 500, 50, 10, 40),
    ];
    const runs = toRuns(items, { f: { ascent: 0.8, descent: -0.2 } }, frame);
    expect(runs.map((r) => r.str)).toEqual([
      "Title",
      "Body text",
      "continues",
      "line two",
      "far right column",
      "rotated",
    ]);
    expect(runs[0]?.edges).toEqual({ x0: 10, y0: 4, x1: 60, y1: 24 });

    const lines = groupLines(runs);
    expect(lines.map((l) => l.text)).toEqual([
      "Title",
      "Body text continues",
      "line two",
      "far right column",
      "rotated",
    ]);
    const blocks = groupBlocks(lines);
    expect(blocks.map((b) => b.lines.map((l) => l.text))).toEqual([
      ["Title"],
      ["Body text continues", "line two"],
      ["far right column"],
      ["rotated"],
    ]);
    const body = bodySize(blocks);
    expect(body).toBe(10);
    expect(blocks.map((b) => roleOf(b, body))).toEqual(["heading", "paragraph", "paragraph", "paragraph"]);
    expect(Math.abs(lines[4]?.angle ?? 0)).toBeCloseTo(Math.PI / 2, 5);
  });

  it("ignores malformed items", () => {
    const junk = [
      null,
      3,
      { str: "x", transform: [1, 2], width: 1, height: 1, fontName: "f" },
      item("ok", 1, 50, 0.1, 1),
    ];
    expect(toRuns(junk, {}, frame)).toEqual([]);
  });
});

/** pdf.js encodes `W n` as a clip op followed by constructPath(endPath). */
const END_PATH = 28;
const path = (op: number, data: number[], minMax: number[]) => [op, [Float32Array.from(data)], minMax];
const rect = (x: number, y: number, w: number, h: number) => [
  DRAW.moveTo,
  x,
  y,
  DRAW.lineTo,
  x + w,
  y,
  DRAW.lineTo,
  x + w,
  y + h,
  DRAW.lineTo,
  x,
  y + h,
  DRAW.closePath,
];

describe("operator walk", () => {
  const walk = (ops: [number, unknown[]][], extra = {}) =>
    walkOperators({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) }, OPS, {
      ...frame,
      minStroke: 0.5,
      ...extra,
    });

  it("keeps simple paths as vectors and sends images, patterns and odd clips to the bitmap", () => {
    const scan = walk([
      [OPS.setStrokeRGBColor, ["#FF0000"]],
      [OPS.setLineWidth, [2]],
      [OPS.setDash, [[3, 1], 0]],
      [OPS.constructPath, path(OPS.stroke, [DRAW.moveTo, 10, 90, DRAW.lineTo, 190, 90], [10, 90, 190, 90])],
      [OPS.save, []],
      [OPS.clip, []],
      [OPS.constructPath, path(END_PATH, rect(0, 0, 100, 100), [0, 0, 100, 100])],
      [OPS.setFillRGBColor, ["#00ff00"]],
      [OPS.constructPath, path(OPS.fill, rect(50, 10, 100, 20), [50, 10, 150, 30])],
      [OPS.restore, []],
      [OPS.save, []],
      [OPS.eoClip, []],
      [
        OPS.constructPath,
        path(END_PATH, [DRAW.moveTo, 0, 0, DRAW.lineTo, 100, 0, DRAW.lineTo, 0, 100], [0, 0, 100, 100]),
      ],
      [OPS.constructPath, path(OPS.fill, rect(60, 40, 80, 20), [60, 40, 140, 60])],
      [OPS.restore, []],
      [OPS.setFillColorN, ["Pattern"]],
      [OPS.constructPath, path(OPS.fill, rect(0, 0, 10, 10), [0, 0, 10, 10])],
      [OPS.save, []],
      [OPS.transform, [40, 0, 0, 30, 150, 60]],
      [OPS.paintImageXObject, ["img1", 4, 3]],
      [OPS.restore, []],
      [OPS.beginAnnotation, ["a1"]],
      [OPS.constructPath, path(OPS.fill, rect(0, 0, 200, 100), [0, 0, 200, 100])],
      [OPS.endAnnotation, []],
      [OPS.constructPath, [OPS.fill, "not a path", null]],
    ]);
    expect(scan.complete).toBe(true);
    expect(scan.shapes).toHaveLength(2);
    const [rule, box] = scan.shapes as [VectorShape, VectorShape];
    expect(rule).toMatchObject({ stroke: "#ff0000", strokeWidth: 2, fill: "none", straight: true, segments: 1 });
    expect(rule.attrs["stroke-dasharray"]).toBe("3 1");
    expect(rule.edges).toEqual({ x0: 9, y0: 9, x1: 191, y1: 11 });
    // Cut by a rectangular clip: still a vector, clipped.
    expect(box.fill).toBe("#00ff00");
    expect(box.clip).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(box.edges).toEqual({ x0: 50, y0: 70, x1: 100, y1: 90 });
    expect(scan.regions.map((r) => [r.kind, r.edges])).toEqual([
      ["vector", { x0: 60, y0: 40, x1: 100, y1: 60 }],
      ["vector", { x0: 0, y0: 90, x1: 10, y1: 100 }],
      ["image", { x0: 150, y0: 10, x1: 190, y1: 40 }],
    ]);
  });

  it("gives up on oversized operator lists instead of blocking", () => {
    const scan = walk(
      [
        [OPS.save, []],
        [OPS.restore, []],
      ],
      { maxOperators: 1 },
    );
    expect(scan).toEqual({ shapes: [], regions: [], complete: false });
  });
});

describe("shape merging", () => {
  const shape = (order: number, edges: Edges, fill: string): VectorShape => ({
    order,
    cmds: [DRAW.moveTo, edges.x0, edges.y0, DRAW.lineTo, edges.x1, edges.y1],
    straight: true,
    segments: 1,
    edges,
    fill,
    attrs: {},
  });

  it("joins touching shapes of one style unless something painted between them overlaps", () => {
    const merged = mergeShapes([
      shape(0, { x0: 0, y0: 0, x1: 100, y1: 1 }, "#000000"),
      shape(1, { x0: 0, y0: 0, x1: 1, y1: 50 }, "#000000"),
      shape(2, { x0: 200, y0: 0, x1: 300, y1: 1 }, "#ff0000"),
      shape(3, { x0: 99, y0: 0, x1: 100, y1: 50 }, "#000000"),
      shape(4, { x0: 50, y0: 0, x1: 60, y1: 50 }, "#ff0000"),
      shape(5, { x0: 0, y0: 49, x1: 100, y1: 50 }, "#000000"),
    ]);
    expect(merged.map((s) => [s.order, s.segments])).toEqual([
      [0, 3],
      [2, 1],
      [4, 1],
      [5, 1],
    ]);
  });
});

describe("ink coverage", () => {
  it("reports ink that no layer covers, grouped into regions", () => {
    const w = 40;
    const h = 20;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    const ink = (x: number, y: number) => px.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
    for (let x = 2; x < 10; x++) ink(x, 3);
    for (let x = 30; x < 34; x++) for (let y = 12; y < 16; y++) ink(x, y);
    const map = inkMap(px, w, h, [255, 255, 255]);
    expect(residualInk(map, [])).toEqual([
      { x0: 0, y0: 0, x1: 12, y1: 4 },
      { x0: 28, y0: 12, x1: 36, y1: 16 },
    ]);
    expect(residualInk(map, [{ x0: 2, y0: 3, x1: 10, y1: 4 }])).toEqual([{ x0: 28, y0: 12, x1: 36, y1: 16 }]);
  });
});

describe("pdf adapter", () => {
  const ctx = { document, width: 800, theme: "light" as const };

  it("exposes its metadata and sniffs the PDF header", () => {
    expect(pdfAdapter).toMatchObject({ id: "pdf", extensions: ["pdf"], mime: ["application/pdf"] });
    const enc = new TextEncoder();
    expect(pdfAdapter.sniff?.(enc.encode("\n\n%PDF-1.7"))).toBe(true);
    expect(pdfAdapter.sniff?.(enc.encode("PK\u0003\u0004"))).toBe(false);
  });

  it.each([
    ["no bytes or URL", {}, {}, "input"],
    ["not a PDF", { bytes: new TextEncoder().encode("<html>") }, {}, "input"],
    ["larger than maxBytes", { bytes: new Uint8Array(64) }, { maxBytes: 16 }, "too-large"],
  ])("rejects %s before loading pdf.js", async (_label, input, options, code) => {
    const load = createPdfAdapter(options).load(input, ctx);
    await expect(load).rejects.toBeInstanceOf(PdfAdapterError);
    await expect(load).rejects.toMatchObject({ code });
  });

  it("rejects invalid options when created", () => {
    expect(() => createPdfAdapter({ maxPages: 0 })).toThrow(RangeError);
    expect(() => createPdfAdapter({ maxPageWidth: Number.NaN })).toThrow(RangeError);
    expect(() => createPdfAdapter({ urlType: "file" as "blob" })).toThrow(RangeError);
  });
});
