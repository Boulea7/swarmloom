import { expect, it } from "vitest";
import { FrameRasterizer } from "../src/browser/raster/rasterize";

/** The resources a snapshot of a box with `background-image: <image>` embeds, by path. */
async function embedded(image: string): Promise<string[]> {
  const frame = document.createElement("iframe");
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.srcdoc = `<div style="width:9px;height:9px;background-image:${image}"></div>`;
  document.body.append(frame);
  await loaded;
  const fetched: string[] = [];
  try {
    const rasterizer = new FrameRasterizer({
      document: frame.contentDocument as Document,
      width: 20,
      height: 20,
      shadows: { roots: () => [], stop: () => undefined },
      fonts: { faces: () => [], stop: () => undefined },
      fetch: (async (url: RequestInfo | URL) => {
        fetched.push(new URL(String(url)).pathname);
        return new Response(null, { status: 404 });
      }) as typeof fetch,
    });
    await rasterizer.snapshot();
  } finally {
    frame.remove();
  }
  return fetched;
}

// The CLI's Chromium at one device pixel per CSS px shows the lowest resolution of at least 1x,
// else the highest, and skips types it cannot decode (SVG among them, unlike Firefox).
it.each([
  ["url(/a.png) 1x, url(/b.png) 2x", ["/a.png"]],
  ["url(/a.png) 2x, url(/b.png) 1.5x", ["/b.png"]],
  ["url(/a.png) 0.5x, url(/b.png) 0.75x", ["/b.png"]],
  ["url(/a.svg) 1x type('image/svg+xml'), url(/b.png) 2x", ["/b.png"]],
])("embeds only the image-set(%s) option the CLI shows", async (options, expected) => {
  expect(await embedded(`image-set(${options})`)).toEqual(expected);
});
