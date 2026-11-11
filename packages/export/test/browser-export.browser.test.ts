import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack } from "mediabunny";
import { afterAll, beforeAll, expect, it } from "vitest";
import emblem from "../../../examples/svg/emblem.svg?raw";
import { VideoFileWriter } from "../src/browser/encode";
import { type BrowserExportOptions, type BrowserExportResult, exportVideo } from "../src/browser/index";
import { frameMicros } from "../src/browser/schedule";

const FPS = 30;
/** Frames whose pixels are kept on their way into the encoder, to compare with the decoded file. */
const CHECKED = [0, 59];
const sent = new Map<number, Uint8ClampedArray<ArrayBuffer>>();
const addFrame = VideoFileWriter.prototype.addFrame;

let container: HTMLElement;
let observer: MutationObserver;

beforeAll(() => {
  VideoFileWriter.prototype.addFrame = function (this: VideoFileWriter, index, rgba) {
    if (CHECKED.includes(index) && rgba instanceof Uint8ClampedArray) sent.set(index, rgba.slice());
    return addFrame.call(this, index, rgba);
  };
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
  VideoFileWriter.prototype.addFrame = addFrame;
  observer.disconnect();
  container.remove();
});

function exportClip(extra: Partial<BrowserExportOptions> = {}): Promise<BrowserExportResult> {
  return exportVideo({
    input: { name: "emblem.svg", type: "image/svg+xml", text: emblem },
    width: 1280,
    height: 720,
    fps: FPS,
    settings: { seed: 7, sound: true },
    maxDurationMs: 2000,
    container,
    hashFrames: true,
    ...extra,
  });
}

async function sha256(bytes: Uint8ClampedArray<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decodes the frames at the given indices, as RGBA. */
async function decodeFrames(track: InputVideoTrack, indices: number[]): Promise<Uint8ClampedArray[]> {
  // The middle of each frame's interval, clear of timestamp rounding in the container.
  const times = indices.map((i) => (frameMicros(i, FPS) + frameMicros(i + 1, FPS)) / 2e6);
  const frames: Uint8ClampedArray[] = [];
  for await (const wrapped of new CanvasSink(track).canvasesAtTimestamps(times)) {
    if (!wrapped) throw new Error("A frame is missing from the file");
    const { canvas } = wrapped;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  }
  return frames;
}

/** Summed RGB difference of two RGBA images at byte offset `i`. */
function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, i: number): number {
  return Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
}

/** Mean per-channel RGB difference (0-255) of two same-size RGBA images, over the pixels `keep` takes. */
function meanDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, keep: (i: number) => boolean = () => true): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!keep(i)) continue;
    sum += pixelDiff(a, b, i);
    n++;
  }
  return sum / (n * 3);
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
  // The file shows the hashed frames, not a blank or frozen picture.
  if (!video) throw new Error("No video track");
  const decoded = await decodeFrames(video, CHECKED);
  const [start, end] = CHECKED.map((i) => sent.get(i) ?? new Uint8ClampedArray());
  expect(await Promise.all([start, end].map(sha256))).toEqual(CHECKED.map((i) => first.frameSha256[i]));
  // Where the swarm moved between the two frames, each decoded frame matches its own.
  const moved = (i: number) => pixelDiff(start, end, i) > 48;
  for (const [k, pixels] of [start, end].entries()) {
    expect(meanDiff(decoded[k], pixels)).toBeLessThan(3);
    expect(meanDiff(decoded[k], pixels, moved)).toBeLessThan(24);
  }
  const audio = await input.getPrimaryAudioTrack();
  expect(audio?.codec ?? null).toBe(first.plan.audio);

  const second = await exportClip();
  expect(second.frameSha256).toEqual(first.frameSha256);

  // Without hashing the encoder takes the canvas itself: the same picture, no hashes.
  const plain = await exportClip({ hashFrames: false, maxDurationMs: 100 });
  expect(plain.frameSha256).toEqual([]);
  const plainVideo = await new Input({
    source: new BlobSource(plain.blob),
    formats: ALL_FORMATS,
  }).getPrimaryVideoTrack();
  if (!plainVideo) throw new Error("No video track");
  const [plainStart] = await decodeFrames(plainVideo, [0]);
  expect(meanDiff(plainStart as Uint8ClampedArray, start)).toBeLessThan(3);
});
