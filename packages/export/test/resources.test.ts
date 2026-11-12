import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { bytesToDataUrl } from "../src/browser/raster/resources";

it("embeds font bytes from another realm", async () => {
  // The export frame's FontFace sources are its own realm's buffers: `instanceof ArrayBuffer` fails.
  const buffer = runInNewContext("new Uint8Array([1, 2, 3, 4]).buffer") as ArrayBuffer;
  expect(buffer instanceof ArrayBuffer).toBe(false);
  expect(await bytesToDataUrl(buffer, "font/ttf")).toBe("data:font/ttf;base64,AQIDBA==");
  expect(await bytesToDataUrl(new Uint8Array([0, 1, 2, 3, 4]).subarray(1), "font/ttf")).toBe(
    "data:font/ttf;base64,AQIDBA==",
  );
});
