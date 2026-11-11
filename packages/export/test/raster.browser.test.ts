import { expect, it } from "vitest";
import { FrameRasterizer } from "../src/browser/raster/rasterize";

const W = 300;
const H = 100;

/** SMIL that changes no CSS property: a motion path, a plain attribute and a point list. */
const PAGE = `<body style="margin:0;background:#fff">
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="5" y="5" width="10" height="10" transform="scale(2)" fill="#f00">
    <animateMotion path="M0,0 L200,0" dur="1s" fill="freeze"/>
  </rect>
  <line x1="10" y1="50" x2="20" y2="50" stroke="#0f0" stroke-width="10">
    <animate attributeName="x2" to="210" dur="1s" fill="freeze"/>
  </line>
  <polygon points="10,70 30,70 30,90 10,90" fill="#00f">
    <animate attributeName="points" to="200,70 230,70 230,90 200,90" dur="1s" fill="freeze"/>
  </polygon>
</svg>`;

it("draws SMIL motion and attribute animations at their animated values", async () => {
  const frame = document.createElement("iframe");
  frame.style.cssText = `position:fixed;left:-2000px;top:0;width:${W}px;height:${H}px;border:0`;
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.srcdoc = PAGE;
  document.body.append(frame);
  try {
    await loaded;
    const doc = frame.contentDocument as Document;
    const svg = doc.querySelector("svg") as SVGSVGElement;
    // The SMIL timeline starts on the frame after load; until then a seek is only remembered.
    await new Promise((resolve) => frame.contentWindow?.requestAnimationFrame(resolve));
    svg.pauseAnimations();
    svg.setCurrentTime(1);
    const rasterizer = new FrameRasterizer({
      document: doc,
      width: W,
      height: H,
      shadows: { roots: () => [], stop() {} },
      fonts: { faces: () => [], stop() {} },
    });
    const ctx = new OffscreenCanvas(W, H).getContext("2d") as OffscreenCanvasRenderingContext2D;
    await rasterizer.draw(ctx);
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    // The motion applies after the rect's own scale(2): x 210-230, not 410-430 or the start 10-30.
    expect({ motion: at(220, 20), line: at(200, 50), points: at(215, 80) }).toEqual({
      motion: [255, 0, 0],
      line: [0, 255, 0],
      points: [0, 0, 255],
    });
  } finally {
    frame.remove();
  }
});
