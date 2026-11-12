import { expect, it } from "vitest";
import { type FaceSource, pickFaces, type Span } from "../src/browser/raster/fonts";

/** A face of family "f" named after its descriptors. */
function face(
  name: string,
  weight: number,
  slanted = false,
  chars: Span[] | null = null,
): FaceSource & { name: string } {
  return {
    name,
    family: "f",
    slanted,
    weight: [weight, weight],
    stretch: [100, 100],
    chars,
    css: () => Promise.resolve({ key: name, css: "" }),
  };
}

const faces = [
  face("regular", 400),
  face("bold", 700),
  face("black", 900),
  face("italic", 400, true),
  face("cyrillic", 400, false, [[0x400, 0x4ff]]),
  face("cjk", 400, false, [[0x4e00, 0x4e2f]]),
];

it.each([
  ["a weight it has", ["normal|400|100%"], [], ["regular"]],
  ["both weights next to one it lacks", ["normal|600|100%"], [], ["regular", "bold"]],
  ["the slanted face for italic text", ["italic|400|100%"], [], ["italic"]],
  ["the faces whose unicode-range holds a shown character", ["normal|400|100%"], [0x4e01], ["regular", "cjk"]],
  ["nothing for a family the frame does not ask for", [], [0x400], []],
])("keeps %s", (_name, asked, chars, expected) => {
  const usage = { faces: new Map([["f", new Set(asked)]]), chars: () => chars };
  expect(pickFaces(faces, usage).map((f) => (f as FaceSource & { name: string }).name)).toEqual(expected);
});
