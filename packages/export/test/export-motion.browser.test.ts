/// <reference types="@vitest/browser-playwright" />
import { afterAll, beforeAll, expect, it } from "vitest";
import { cdp } from "vitest/browser";
import { exportVideo } from "../src/browser/index";

/** The box is blue, or red when the page asks for reduced motion (the CLI emulates no preference). */
const PAGE =
  "<!doctype html><html><head><style>body{margin:0;background:#fff}" +
  ".box{width:100px;height:60px;background:rgb(0,0,255)}" +
  "@media (prefers-reduced-motion: reduce){.box{background:rgb(255,0,0)}}" +
  '</style></head><body><div class="box"></div></body></html>';

let container: HTMLElement;
let observer: MutationObserver;

beforeAll(() => {
  container = document.createElement("div");
  document.body.append(container);
  // Vitest's browser runner wraps dynamic imports through a global of the test page; the export
  // frame is a page of its own, so it gets a pass-through.
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        const win = (node as HTMLIFrameElement).contentWindow as (Window & Record<string, unknown>) | null;
        if (win) win.__vitest_browser_runner__ = { wrapDynamicImport: (load: () => unknown) => load() };
      }
    }
  });
  observer.observe(container, { childList: true });
});

afterAll(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  observer.disconnect();
  container.remove();
});

/** Exports the page; also reports what the export frame's scripts see for reduced motion. */
async function exportPage(): Promise<{ hashes: string[]; frameReduces: boolean | null }> {
  let frameReduces: boolean | null = null;
  const result = await exportVideo({
    input: { name: "motion.html", type: "text/html", text: PAGE },
    width: 160,
    height: 90,
    fps: 5,
    settings: { sound: false, live: false, tail: 400 },
    container,
    onProgress: () => {
      const win = container.querySelector("iframe")?.contentWindow;
      if (win && frameReduces === null) frameReduces = win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    },
  });
  return { hashes: result.frameSha256, frameReduces };
}

it("draws the same frames when the host asks for reduced motion", { timeout: 120_000 }, async () => {
  const plain = await exportPage();
  expect(plain.frameReduces).toBe(false);
  await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
  const reduced = await exportPage();
  expect(reduced.frameReduces).toBe(false);
  expect(reduced.hashes).toEqual(plain.hashes);
});
