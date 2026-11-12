import { describe, expect, it } from "vitest";
import { tagFade, tagOrigin } from "../../src/cursor/index";
import { badgeOrigin } from "../../src/overlay/kinds";

const tag = { w: 40, h: 18 };
const offset = { x: 13, y: 17 };

describe("tagOrigin", () => {
  it.each([
    ["in the open, below right of the hotspot", 100, 100, { x: 113, y: 117 }],
    ["near the right edge, flipped to the left", 700, 100, { x: 656, y: 117 }],
    ["near the bottom edge, flipped above", 100, 400, { x: 113, y: 378 }],
    // Regression: a joiner 40 px left of the canvas drew its tag alone at x = 0.
    ["past the left edge, leaving with the cursor", -40, 100, { x: -27, y: 117 }],
    ["past the right edge, leaving with the cursor", 730, 100, { x: 743, y: 117 }],
  ])("places the tag %s", (_case, cx, cy, expected) => {
    expect(tagOrigin(cx, cy, offset, 1, tag, 720, 405)).toEqual(expected);
  });

  it("fades a tag out as its hotspot moves past an edge by the tag offset", () => {
    expect([0, -6.5, -13, -40].map((cx) => tagFade(cx, 100, offset, 1, 720, 405))).toEqual([1, 0.5, 0, 0]);
    expect(tagFade(100, -17, offset, 1, 720, 405)).toBe(0);
  });

  it("hangs the tag below left beside text, and flips it right at the left edge", () => {
    expect(tagOrigin(100, 100, offset, 1, tag, 720, 405, true)).toEqual({ x: 47, y: 117 });
    expect(tagOrigin(30, 100, offset, 1, tag, 720, 405, true)).toEqual({ x: 43, y: 117 });
  });
});

describe("badgeOrigin", () => {
  const badge = { w: 60, h: 18 };
  // The dragging crosshair's own tag sits at hotspot + (11, 11).
  const own = { x: 111, y: 111, w: 40, h: 18 };
  // Another cursor's tag just right of the badge's usual spot.
  const other = { x: 170, y: 104, w: 36, h: 18 };
  it.each([
    ["below right of its point in the open", [], 405, { x: 106, y: 106 }],
    ["under the dragging cursor's own tag", [own], 405, { x: 106, y: 131 }],
    ["beside its point, above the own tag, at the canvas bottom", [own], 140, { x: 106, y: 91 }],
    // Regression (word take, frame 630): moving right of the own tag put it under the other tag.
    ["clear of every tag when escaping one lands on another", [other, own], 140, { x: 106, y: 91 }],
  ])("places the badge %s", (_case, tags, height, expected) => {
    const at = badgeOrigin(100, 100, badge, tags, 720, height);
    expect(at).toEqual(expected);
  });

  it("skips the frame when no spot on the canvas is clear", () => {
    expect(badgeOrigin(10, 10, badge, [{ x: 0, y: 0, w: 100, h: 60 }], 100, 60)).toBeNull();
  });
});
