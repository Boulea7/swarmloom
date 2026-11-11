import { describe, expect, it } from "vitest";
import { tagOrigin } from "../../src/cursor/index";

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
});
