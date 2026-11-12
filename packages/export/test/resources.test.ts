import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { BLANK_IMAGE, bytesToDataUrl, networkGate, ResourceCache } from "../src/browser/raster/resources";

it("embeds font bytes from another realm", async () => {
  // The export frame's FontFace sources are its own realm's buffers: `instanceof ArrayBuffer` fails.
  const buffer = runInNewContext("new Uint8Array([1, 2, 3, 4]).buffer") as ArrayBuffer;
  expect(buffer instanceof ArrayBuffer).toBe(false);
  expect(await bytesToDataUrl(buffer, "font/ttf")).toBe("data:font/ttf;base64,AQIDBA==");
  expect(await bytesToDataUrl(new Uint8Array([0, 1, 2, 3, 4]).subarray(1), "font/ttf")).toBe(
    "data:font/ttf;base64,AQIDBA==",
  );
});

it("fetches no image from another site, only own images and fonts", async () => {
  // The frame loads another site's image without CORS, so without an Origin header; a fetch from
  // the exporting page would send its origin. Fonts load with CORS in the frame as well.
  const fetched: [string, RequestInit][] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    fetched.push([url, init]);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  const warnings: string[] = [];
  const gate = networkGate("https", "https://host.example/app.html");
  const cache = new ResourceCache(fetcher, (message) => warnings.push(message), gate);
  const drawn = "data:image/png;base64,ZHJhd24=";
  expect(await cache.resolve("https://images.example/a.png", () => drawn)).toBe(drawn);
  expect(await cache.resolve("https://images.example/b.png")).toBe(BLANK_IMAGE);
  expect(await cache.resolve("/own.png")).toBe("data:image/png;base64,AQID");
  expect(await cache.font("https://fonts.example/f.woff2")).toBe("data:image/png;base64,AQID");
  const init = { credentials: "omit", referrerPolicy: "no-referrer" };
  expect(fetched).toEqual([
    ["https://host.example/own.png", init],
    ["https://fonts.example/f.woff2", init],
  ]);
  expect(warnings).toEqual([expect.stringMatching(/^https:\/\/images\.example\/b\.png could not be embedded/)]);
});
