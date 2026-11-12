import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { bytesToDataUrl, networkGate, ResourceCache } from "../src/browser/raster/resources";

it("embeds font bytes from another realm", async () => {
  // The export frame's FontFace sources are its own realm's buffers: `instanceof ArrayBuffer` fails.
  const buffer = runInNewContext("new Uint8Array([1, 2, 3, 4]).buffer") as ArrayBuffer;
  expect(buffer instanceof ArrayBuffer).toBe(false);
  expect(await bytesToDataUrl(buffer, "font/ttf")).toBe("data:font/ttf;base64,AQIDBA==");
  expect(await bytesToDataUrl(new Uint8Array([0, 1, 2, 3, 4]).subarray(1), "font/ttf")).toBe(
    "data:font/ttf;base64,AQIDBA==",
  );
});

it("fetches resources without credentials or a referrer", async () => {
  // A host page without a referrer meta would otherwise send its own origin to every image server.
  const seen: RequestInit[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    seen.push(init);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  const cache = new ResourceCache(fetcher, () => undefined, networkGate("https", "https://host.example/app.html"));
  expect(await cache.resolve("https://images.example/p.png")).toBe("data:image/png;base64,AQID");
  expect(seen).toEqual([{ credentials: "omit", referrerPolicy: "no-referrer" }]);
});
