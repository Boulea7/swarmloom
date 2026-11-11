import { describe, expect, it } from "vitest";
import { tagOrigin } from "../../src/cursor/index";
import { badgeOrigin } from "../../src/overlay/kinds";

const tag = { w: 40, h: 18 };
const offset = { x: 13, y: 17 };

describe("tagOrigin", () => {
  it.each([
    ["in the open, below right of the hotspot", 100, 100, { x: 113, y: 117 }],
    ["near the right edge, flipped to the left", 700, 100, { x: 656, y: 117 }],
    ["near the bottom edge, flipped above", 100, 400, { x: 113, y: 378 }],
    ["past the right edge, kept on the canvas", 730, 100, { x: 680, y: 117 }],
  ])("places the tag %s", (_case, cx, cy, expected) => {
    expect(tagOrigin(cx, cy, offset, 1, tag, 720, 405)).toEqual(expected);
  });

  it("hangs the tag below left beside text, and flips it right at the left edge", () => {
    expect(tagOrigin(100, 100, offset, 1, tag, 720, 405, true)).toEqual({ x: 47, y: 117 });
    expect(tagOrigin(30, 100, offset, 1, tag, 720, 405, true)).toEqual({ x: 43, y: 117 });
  });
});

describe("badgeOrigin", () => {
  it("moves a size badge under the name tag it would overlap, or right of it at the canvas bottom", () => {
    const badge = { w: 60, h: 18 };
    // The dragging crosshair's own tag sits at hotspot + (11, 11).
    const own = { x: 111, y: 111, w: 40, h: 18 };
    expect(badgeOrigin(100, 100, badge, [], 405)).toEqual({ x: 106, y: 106 });
    expect(badgeOrigin(100, 100, badge, [own], 405)).toEqual({ x: 106, y: 131 });
    expect(badgeOrigin(100, 100, badge, [{ ...own, x: 300 }], 405)).toEqual({ x: 106, y: 106 });
    expect(badgeOrigin(100, 100, badge, [own], 140)).toEqual({ x: 153, y: 106 });
  });
});
