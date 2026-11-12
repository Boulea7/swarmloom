import { afterEach, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import "../src/styles/studio.css";

const [WIDTH, HEIGHT] = [1080, 720];

afterEach(async () => {
  await cdp().send("Emulation.clearDeviceMetricsOverride");
  document.body.replaceChildren();
});

// A 48 px hinge, as a dual-screen device reports it through Viewport Segments (emulated over CDP).
it.each([
  { orientation: "vertical", query: "(horizontal-viewport-segments: 2)", hinge: [516, 564] },
  { orientation: "horizontal", query: "(vertical-viewport-segments: 2)", hinge: [336, 384] },
] as const)("keeps a centred dialog off a $orientation hinge", async ({ orientation, query, hinge }) => {
  await page.viewport(WIDTH, HEIGHT);
  await cdp().send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
    displayFeature: { orientation, offset: hinge[0], maskLength: hinge[1] - hinge[0] },
  });
  expect(matchMedia(query).matches).toBe(true);

  const dialog = document.createElement("dialog");
  dialog.className = "panel panel-dialog";
  const body = document.createElement("div");
  body.className = "panel-body";
  body.textContent = "A long line of export help text. ".repeat(80);
  dialog.append(body);
  document.body.append(dialog);
  dialog.showModal();
  for (const animation of dialog.getAnimations()) animation.finish();

  // Wholly inside the second pane: right of a vertical hinge, below a horizontal one.
  const box = dialog.getBoundingClientRect();
  const [start, end] = orientation === "vertical" ? [box.left, box.right] : [box.top, box.bottom];
  expect(start).toBeGreaterThanOrEqual(hinge[1]);
  expect(end).toBeLessThanOrEqual(orientation === "vertical" ? WIDTH : HEIGHT);
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
});
