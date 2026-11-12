import { expect, it } from "vitest";
import { FrameRasterizer } from "../src/browser/raster/rasterize";

/**
 * Forms the html adapter's own policy misses; Chromium computes each into a plain `url()`. Another
 * site's images are never fetched (the frame loads them without CORS); its fonts only under "https".
 */
const PAGE =
  "<style>@font-face{font-family:R;src:url(https://remote.invalid/r.woff2)}</style>" +
  '<body background="https://remote.invalid/bg.png"><p style="font-family:R">R</p>' +
  "<div style=\"width:9px;height:9px;background-image:image-set('https://remote.invalid/set.png' 1x)\"></div>" +
  '<div style="width:9px;height:9px;background-image:url(http://remote.invalid/plain.png)"></div>' +
  '<div style="width:9px;height:9px;background-image:url(/own.png)"></div></body>';

async function fetchedUrls(network: "https" | "none"): Promise<string[]> {
  const frame = document.createElement("iframe");
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.srcdoc = PAGE;
  document.body.append(frame);
  await loaded;
  const fetched: string[] = [];
  try {
    const doc = frame.contentDocument as Document;
    const rasterizer = new FrameRasterizer({
      document: doc,
      width: 40,
      height: 40,
      shadows: { roots: () => [], stop: () => undefined },
      fonts: { faces: () => [], stop: () => undefined },
      network,
      fetch: (async (url: RequestInfo | URL) => {
        fetched.push(String(url));
        return new Response(null, { status: 404 });
      }) as typeof fetch,
    });
    await rasterizer.snapshot();
  } finally {
    frame.remove();
  }
  return fetched.sort();
}

it.each([
  ["none", [`${location.origin}/own.png`]],
  ["https", [`${location.origin}/own.png`, "https://remote.invalid/r.woff2"]],
] as const)("fetches only what the %s policy lets the frame load", async (network, expected) => {
  expect(await fetchedUrls(network)).toEqual([...expected].sort());
});
