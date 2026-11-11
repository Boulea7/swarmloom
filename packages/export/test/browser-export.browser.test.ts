import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { afterAll, beforeAll, expect, it } from "vitest";
import emblem from "../../../examples/svg/emblem.svg?raw";
import { type BrowserExportResult, exportVideo } from "../src/browser/index";

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

afterAll(() => {
  observer.disconnect();
  container.remove();
});

function exportClip(): Promise<BrowserExportResult> {
  return exportVideo({
    input: { name: "emblem.svg", type: "image/svg+xml", text: emblem },
    width: 1280,
    height: 720,
    fps: 30,
    settings: { seed: 7, sound: true },
    maxDurationMs: 2000,
    container,
  });
}

it("exports a 2 s clip that parses, with identical frames on a second run", { timeout: 180_000 }, async () => {
  const first = await exportClip();
  expect(first).toMatchObject({ frames: 60, durationMs: 2000, finished: false, extension: first.plan.container });
  expect(first.frameSha256).toHaveLength(60);
  // The build moves: a still clip would make the hash comparison meaningless.
  expect(new Set(first.frameSha256).size).toBeGreaterThan(10);
  expect(container.childElementCount).toBe(0);

  const input = new Input({ source: new BlobSource(first.blob), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  expect(video?.codec).toBe(first.plan.video);
  expect([video?.displayWidth, video?.displayHeight]).toEqual([1280, 720]);
  expect((await video?.computePacketStats())?.packetCount).toBe(60);
  expect(await video?.computeDuration()).toBeCloseTo(2, 3);
  const audio = await input.getPrimaryAudioTrack();
  expect(audio?.codec ?? null).toBe(first.plan.audio);

  const second = await exportClip();
  expect(second.frameSha256).toEqual(first.frameSha256);
});
