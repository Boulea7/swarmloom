import { afterEach, describe, expect, it } from "vitest";
import "../src/styles/tokens.css";
import "../src/styles/scenes.css";
import { deviceSvg } from "../src/render/art/devices";

describe("device screens", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  // Regression: a clip-path on the nested scene <svg> was resolved in the scene's own coordinates,
  // which cut off the left and top of every device screen by the screen's offset.
  it("show the scene edge to edge inside the screen", () => {
    const host = document.createElement("div");
    host.style.width = "600px";
    host.innerHTML = deviceSvg("laptop", "Laptop");
    document.body.append(host);
    const art = host.querySelector<SVGSVGElement>(".device-art") as SVGSVGElement;
    art.style.display = "block";
    art.style.width = "600px";

    // The page's nav dot is the scene piece closest to the screen's left edge.
    const dot = host.querySelector<SVGCircleElement>(".scene .sc-root circle") as SVGCircleElement;
    const box = dot.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)).toBe(dot);
  });
});
