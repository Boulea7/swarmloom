import { describe, expect, it } from "vitest";
import { svgAdapter } from "../src/index";
import { extractAnchors } from "../src/path/anchors";
import { pathBounds, serializePath, transformSegments } from "../src/path/geometry";
import { parsePathData } from "../src/path/parse";
import { parsePoints, rectSegments } from "../src/path/shapes";
import { sanitizeCss, sanitizeSvgTree } from "../src/sanitize";
import { looksLikeSvg } from "../src/source";
import { stageSize } from "../src/units";

describe("parsePathData", () => {
  it.each([
    ["absolute and relative lines, implicit repetition", "M10 10 l5 0 5 5 H40 v-10z", "M10 10L15 10L20 15L40 15L40 5Z"],
    ["moveto repeats as lineto", "m1 2 3 4 5 6", "M1 2L4 6L9 12"],
    ["compact numbers and exponents", "M.5.5L1e1-2e0", "M0.5 0.5L10 -2"],
    [
      "S reflects the previous cubic control",
      "M0 0C0 10 10 10 10 0S20 -10 20 0",
      "M0 0C0 10 10 10 10 0C10 -10 20 -10 20 0",
    ],
    ["T reflects the previous quadratic control", "M0 0Q5 10 10 0T20 0", "M0 0Q5 10 10 0Q15 -10 20 0"],
    ["arc flags without separators", "M0 0a5 5 0 1010 0", "M0 0A5 5 0 1 0 10 0"],
    ["zero-radius arc becomes a line", "M0 0A0 5 0 0 1 10 0", "M0 0L10 0"],
    ["closepath returns the pen to the subpath start", "M10 10h10z l5 5", "M10 10L20 10ZL15 15"],
  ])("%s", (_name, src, expected) => {
    const parsed = parsePathData(src);
    expect(parsed.error).toBeUndefined();
    expect(serializePath(parsed.segments)).toBe(expected);
  });

  it("keeps the segments before the first error", () => {
    const parsed = parsePathData("M0 0L10 10L20 x30 30");
    expect(parsed.error).toMatch(/bad argument/);
    expect(serializePath(parsed.segments)).toBe("M0 0L10 10");
    expect(parsePathData("L10 10").error).toMatch(/moveto/);
  });
});

describe("extractAnchors", () => {
  it("places anchors on endpoints with cubic handles and merges the closing point", () => {
    const anchors = extractAnchors(parsePathData("M0 0C0 10 10 10 10 0L10 -10L0 0Z").segments);
    expect(anchors).toEqual([
      { x: 0, y: 0, start: true, out: { x: 0, y: 10 } },
      { x: 10, y: 0, in: { x: 10, y: 10 } },
      { x: 10, y: -10, close: true },
    ]);
  });

  it("marks every subpath start and keeps arcs free of fake handles", () => {
    const anchors = extractAnchors(parsePathData("M0 0A5 5 0 0 1 10 0M20 0Q25 5 30 0").segments);
    expect(anchors.map((a) => [a.x, a.y, !!a.start])).toEqual([
      [0, 0, true],
      [10, 0, false],
      [20, 0, true],
      [30, 0, false],
    ]);
    expect(anchors[1]?.in).toBeUndefined();
    expect(anchors[3]?.in).toEqual({ x: 25, y: 5 });
  });

  it("caps long paths to evenly spaced anchors", () => {
    const pts = Array.from({ length: 100 }, (_, i) => `${i} ${i % 2}`).join(" ");
    const anchors = extractAnchors(parsePathData(`M${pts}`).segments, 8);
    expect(anchors).toHaveLength(8);
    expect(anchors[0]).toMatchObject({ x: 0, start: true });
    expect(anchors[7]?.x).toBe(99);
  });
});

describe("geometry", () => {
  it("computes exact bounds of curves and arcs, not of their control points", () => {
    expect(pathBounds(parsePathData("M0 0Q50 100 100 0").segments)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    const circle = pathBounds(parsePathData("M10 0A10 10 0 0 1 -10 0A10 10 0 0 1 10 0").segments);
    expect(circle?.x).toBeCloseTo(-10);
    expect(circle?.y).toBeCloseTo(-10);
    expect(circle?.w).toBeCloseTo(20);
    expect(circle?.h).toBeCloseTo(20);
  });

  it("transforms arcs exactly under non-uniform scale and reflection", () => {
    const [, arc] = transformSegments(parsePathData("M0 0A10 5 90 0 1 10 0").segments, [2, 0, 0, -1, 0, 0]);
    expect(arc?.type).toBe("A");
    if (arc?.type !== "A") return;
    // The rotated ellipse has its 10-unit axis vertical; x scale 2 doubles the 5-unit horizontal axis.
    expect(Math.max(arc.rx, arc.ry)).toBeCloseTo(10);
    expect(Math.min(arc.rx, arc.ry)).toBeCloseTo(10);
    expect(arc.sweep).toBe(false);
    expect(arc.x).toBeCloseTo(20);
  });

  it("builds rounded rects from the specified start point", () => {
    // rx clamps to half the width, auto ry follows rx and clamps to half the height.
    expect(serializePath(rectSegments(0, 0, 40, 20, 5))).toBe(
      "M5 0L35 0A5 5 0 0 1 40 5L40 15A5 5 0 0 1 35 20L5 20A5 5 0 0 1 0 15L0 5A5 5 0 0 1 5 0Z",
    );
    expect(serializePath(rectSegments(0, 0, 20, 10, 50))).toBe(
      "M10 0L10 0A10 5 0 0 1 20 5L20 5A10 5 0 0 1 10 10L10 10A10 5 0 0 1 0 5L0 5A10 5 0 0 1 10 0Z",
    );
    expect(parsePoints("1,2 3 4 5")).toEqual([1, 2, 3, 4]);
  });
});

describe("sanitizing helpers", () => {
  it("drops external references from CSS and keeps fragments and inline images", () => {
    const css = sanitizeCss(
      '@import "x.css"; a{fill:url(#g);background:url(https://evil.test/a.png)} b{mask:url("data:image/png;base64,AA")} c{x:u\\72l(//e.test)}',
    );
    expect(css).not.toContain("evil.test");
    expect(css).not.toContain("@import");
    // The escaped "u\72l(" decodes to url( and is neutralised like a plain one.
    expect(css).toContain("c{x:none}");
    expect(css).toContain("url(#g)");
    expect(css).toContain('url("data:image/png;base64,AA")');
  });

  it("drops href animations whatever prefix binds the xlink namespace", () => {
    const svg = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:l="http://www.w3.org/1999/xlink">
        <image><animate attributeName="l:href" values="https://evil.test/p.png" dur="1s"/></image>
        <a><set attributeName=" L:HREF " to="https://evil.test/phish"/></a>
        <rect><animate attributeName="opacity" values="0;1" dur="1s"/></rect></svg>`,
      "image/svg+xml",
    ).documentElement;
    sanitizeSvgTree(svg);
    expect(Array.from(svg.querySelectorAll("animate, set"), (a) => a.getAttribute("attributeName"))).toEqual([
      "opacity",
    ]);
    expect(svg.outerHTML).not.toContain("evil.test");
  });

  it("sniffs SVG through prologs, comments and doctypes", () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
    expect(looksLikeSvg(enc('<?xml version="1.0"?>\n<!-- c --><!DOCTYPE svg><svg xmlns="x"/>'))).toBe(true);
    expect(looksLikeSvg(enc("<html><svg/></html>"))).toBe(false);
  });
});

describe("stageSize", () => {
  it.each([
    ["a wide banner fills the width", { w: 1600, h: 400 }, { w: 1280, h: 320 }],
    ["a square logo fits whole into the 16:9 frame", { w: 480, h: 480 }, { w: 720, h: 720 }],
    ["a tall diagram keeps the width and scrolls", { w: 600, h: 800 }, { w: 1280, h: 1707 }],
    ["an extreme strip stops at the height limit", { w: 10, h: 100_000 }, { w: 6, h: 60_000 }],
  ])("%s", (_name, intrinsic, expected) => {
    expect(stageSize(intrinsic, 1280)).toEqual(expected);
  });

  it("fills the width when asked to (callers that lay out in stage space)", () => {
    expect(stageSize({ w: 480, h: 480 }, 1280, "width")).toEqual({ w: 1280, h: 1280 });
  });
});

describe("svgAdapter input validation", () => {
  const ctx = { document, width: 800, theme: "light" as const };

  it("rejects missing input, bad markup and non-SVG roots", async () => {
    await expect(svgAdapter.load({}, ctx)).rejects.toThrow(/needs text, bytes/);
    await expect(svgAdapter.load({ text: "<svg><g></svg>" }, ctx)).rejects.toThrow(/Invalid SVG/);
    await expect(svgAdapter.load({ text: "<html xmlns='http://www.w3.org/1999/xhtml'/>" }, ctx)).rejects.toThrow(
      /Not an SVG/,
    );
    await expect(svgAdapter.load({ text: "<svg/>" }, { ...ctx, width: 0 })).rejects.toThrow(/width/);
  });

  it("exposes registry metadata", () => {
    expect(svgAdapter.id).toBe("svg");
    expect(svgAdapter.extensions).toContain("svg");
    expect(svgAdapter.sniff?.(new TextEncoder().encode("<svg>"))).toBe(true);
  });
});
