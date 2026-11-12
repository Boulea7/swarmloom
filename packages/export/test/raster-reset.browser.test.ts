import { afterEach, expect, it } from "vitest";
import { FrameRasterizer } from "../src/browser/raster/rasterize";

const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

/** Appends an iframe and resolves with its document once it has loaded. */
async function loadFrame(setup: (frame: HTMLIFrameElement) => void): Promise<Document> {
  const frame = document.createElement("iframe");
  frames.push(frame);
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  setup(frame);
  document.body.append(frame);
  await loaded;
  const doc = frame.contentDocument;
  if (!doc) throw new Error("the frame document is not readable");
  return doc;
}

it("leaves the wrapping foreignObject out of the clone reset", async () => {
  const stage = await loadFrame((frame) => {
    frame.srcdoc = '<body style="margin:0;background:#07c160"></body>';
  });
  const rasterizer = new FrameRasterizer({
    document: stage,
    width: 320,
    height: 180,
    shadows: { roots: () => [], stop: () => {} },
    fonts: { faces: () => [], stop: () => {} },
  });
  const { svg } = await rasterizer.snapshot();

  // The snapshot as a same-origin SVG document, so its style sheet applies and can be read back.
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = await loadFrame((frame) => {
      frame.src = url;
    });
    const wrapper = image.querySelector("foreignObject");
    if (!wrapper) throw new Error("the snapshot has no foreignObject");
    // A reset wrapper has an `auto` (Firefox) or `0px` (Chromium) size, and Firefox draws nothing.
    const cs = image.defaultView?.getComputedStyle(wrapper);
    expect([cs?.width, cs?.height]).toEqual(["320px", "180px"]);
  } finally {
    URL.revokeObjectURL(url);
  }
});
