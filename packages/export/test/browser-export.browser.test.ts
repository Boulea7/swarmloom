import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  CanvasSink,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
} from "mediabunny";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { server } from "vitest/browser";
import emblem from "../../../examples/svg/emblem.svg?raw";
import { planEncoding, VideoFileWriter, webCodecsProbe } from "../src/browser/encode";
import { type BrowserExportOptions, type BrowserExportResult, exportVideo } from "../src/browser/index";
import { frameMicros } from "../src/browser/schedule";
import { BlobSink, PART_BYTES, PacketSpool } from "../src/browser/spool";
import type { RenderApi } from "../src/render/protocol";

const FPS = 30;
/**
 * Mean per-channel difference a decoded frame may have from the one encoded. Playwright's Linux
 * WebKit encodes through GStreamer, which loses a little more at the same bitrate.
 */
const LOSS = server.browser === "webkit" ? 6 : 3;
/** Frames whose pixels are kept on their way into the encoder, to compare with the decoded file. */
const CHECKED = [0, 59];
const sent = new Map<number, Uint8ClampedArray<ArrayBuffer>>();
const addFrame = VideoFileWriter.prototype.addFrame;

let container: HTMLElement;
let observer: MutationObserver;
/** Called with each export frame as it is added, before it loads. */
let onFrame: ((frame: HTMLIFrameElement) => void) | null = null;

beforeAll(() => {
  VideoFileWriter.prototype.addFrame = function (this: VideoFileWriter, index, rgba) {
    if (CHECKED.includes(index) && rgba instanceof Uint8ClampedArray) sent.set(index, rgba.slice());
    return addFrame.call(this, index, rgba);
  };
  container = document.createElement("div");
  document.body.append(container);
  // Vitest's browser runner wraps dynamic imports through a global of the test page; the export
  // frame is a page of its own, so it gets a pass-through: when added, and again on load in the
  // capture phase, before the exporter's listener on the frame, as WebKit gives the srcdoc page a
  // window other than the frame's first one.
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLIFrameElement)) continue;
        passThroughImports(node);
        onFrame?.(node);
      }
    }
  });
  observer.observe(container, { childList: true });
  container.addEventListener("load", onFrameLoad, true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  VideoFileWriter.prototype.addFrame = addFrame;
  observer.disconnect();
  container.removeEventListener("load", onFrameLoad, true);
  container.remove();
});

function passThroughImports(frame: HTMLIFrameElement): void {
  const win = frame.contentWindow as (Window & Record<string, unknown>) | null;
  if (win) win.__vitest_browser_runner__ = { wrapDynamicImport: (load: () => unknown) => load() };
}

function onFrameLoad(event: Event): void {
  if (event.target instanceof HTMLIFrameElement) passThroughImports(event.target);
}

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

/** Decoded length in seconds and loudest absolute sample of an audio track. */
async function decodeAudio(track: InputAudioTrack): Promise<{ seconds: number; peak: number }> {
  let seconds = 0;
  let peak = 0;
  for await (const { buffer, duration } of new AudioBufferSink(track).buffers()) {
    seconds += duration;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      for (const sample of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(sample));
    }
  }
  return { seconds, peak };
}

/** Types of the top-level boxes of an MP4 file, in order. */
async function topLevelBoxes(blob: Blob): Promise<string[]> {
  const types: string[] = [];
  for (let offset = 0; offset < blob.size; ) {
    const header = new DataView(await blob.slice(offset, offset + 16).arrayBuffer());
    const size = header.getUint32(0);
    types.push(String.fromCharCode(...new Uint8Array(header.buffer, 4, 4)));
    offset += size === 1 ? Number(header.getBigUint64(8)) : size === 0 ? blob.size : size;
  }
  return types;
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
  const spooled = vi.spyOn(PacketSpool.prototype, "add");
  const written = vi.spyOn(BlobSink.prototype, "blob");
  const first = await exportClip();
  expect(first).toMatchObject({ frames: 60, durationMs: 2000, finished: false, extension: first.plan.container });
  // The encoded frames waited in a spool rather than in the muxer, and the file is the Blob-backed sink's.
  const perSpool = new Map<unknown, number>();
  for (const spool of spooled.mock.contexts) perSpool.set(spool, (perSpool.get(spool) ?? 0) + 1);
  expect([...perSpool.values()]).toContain(60);
  expect(written.mock.results).toHaveLength(1);
  expect(written.mock.results[0]?.value).toBe(first.blob);
  expect(first.frameSha256).toHaveLength(60);
  // The build moves: a still clip would make the hash comparison meaningless.
  expect(new Set(first.frameSha256).size).toBeGreaterThan(10);
  expect(container.childElementCount).toBe(0);

  const input = new Input({ source: new BlobSource(first.blob), formats: ALL_FORMATS });
  if (first.plan.container === "mp4") {
    // Streamed into the file, the media still comes after the index (fast start, as from the CLI).
    const boxes = await topLevelBoxes(first.blob);
    expect(boxes.indexOf("moov")).toBeGreaterThan(-1);
    expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));
  }
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
    expect(meanDiff(decoded[k], pixels)).toBeLessThan(LOSS);
    expect(meanDiff(decoded[k], pixels, moved)).toBeLessThan(24);
  }
  // Each engine here encodes Opus or AAC in either container, so sound=true always gets a soundtrack.
  expect(first.plan.audio).not.toBeNull();
  const audio = await input.getPrimaryAudioTrack();
  expect(audio?.codec).toBe(first.plan.audio);
  if (!audio) throw new Error("No audio track");
  // It covers the whole clip and is not silent.
  const sound = await decodeAudio(audio);
  expect(sound.seconds).toBeCloseTo(2, 1);
  expect(sound.peak).toBeGreaterThan(0.01);

  const second = await exportClip();
  expect(second.frameSha256).toEqual(first.frameSha256);

  // Without hashing the encoder takes the canvas itself: the same picture, no hashes. This one is
  // WebM (VP9), as where H.264 is missing, whose header the muxer writes again at the end.
  const plain = await exportClip({
    hashFrames: false,
    maxDurationMs: 100,
    probe: {
      ...webCodecsProbe,
      video: async (codec, ...size) => codec === "vp9" && webCodecsProbe.video(codec, ...size),
    },
  });
  expect(plain.frameSha256).toEqual([]);
  expect([plain.extension, plain.blob.type]).toEqual(["webm", "video/webm"]);
  const plainInput = new Input({ source: new BlobSource(plain.blob), formats: ALL_FORMATS });
  const plainVideo = await plainInput.getPrimaryVideoTrack();
  if (!plainVideo) throw new Error("No video track");
  expect([plainVideo.codec, (await plainVideo.computePacketStats()).packetCount]).toEqual(["vp9", 3]);
  expect((await plainInput.getPrimaryAudioTrack())?.codec).toBe(plain.plan.audio);
  const [plainStart] = await decodeFrames(plainVideo, [0]);
  expect(meanDiff(plainStart as Uint8ClampedArray, start)).toBeLessThan(LOSS);
});

it("streams a video larger than a Blob part through the spool into the file", { timeout: 180_000 }, async () => {
  // One frame a second gives a rate-controlled encoder a large budget per frame, and fresh noise does
  // not compress, so a few frames fill more than a part whatever the engine's encoder.
  const [width, height, fps] = [1280, 720, 1];
  const add = PacketSpool.prototype.add;
  let spooledBytes = 0;
  let heldBytes = 0;
  const spooled = vi.spyOn(PacketSpool.prototype, "add").mockImplementation(function (
    this: PacketSpool<{ decoderConfig?: unknown }>,
    packet,
    meta,
  ) {
    add.call(this, packet, meta);
    spooledBytes += packet.byteLength;
    heldBytes = Math.max(heldBytes, this.heldBytes);
  });
  const written = vi.spyOn(BlobSink.prototype, "blob");
  const writer = new VideoFileWriter(await planEncoding(width, height, fps, false), width, height, fps);
  await writer.start();
  const noise = new Uint8ClampedArray(width * height * 4);
  const words = new Uint32Array(noise.buffer);
  let seed = 0x9e3779b9;
  let frames = 0;
  // Packets come back behind the frames, so this overshoots a little; the cap bounds a slow encoder.
  while (spooledBytes < 2 * PART_BYTES && frames < 90) {
    for (let i = 0; i < words.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      words[i] = seed | 0xff000000;
    }
    await writer.addFrame(frames++, noise);
  }
  const blob = await writer.finish();

  // More than a part went through the spool, which never held more than a part in script memory.
  expect(spooled).toHaveBeenCalledTimes(frames);
  expect(spooledBytes).toBeGreaterThan(PART_BYTES);
  expect(heldBytes).toBeLessThanOrEqual(PART_BYTES);
  // The file came out of the Blob-backed sink, larger than a part, and holds every frame.
  expect(written.mock.results).toHaveLength(1);
  expect(written.mock.results[0]?.value).toBe(blob);
  expect(blob.size).toBeGreaterThan(PART_BYTES);
  if (writer.plan.container === "mp4") {
    const boxes = await topLevelBoxes(blob);
    expect(boxes.indexOf("moov")).toBeGreaterThan(-1);
    expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));
  }
  const video = await new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }).getPrimaryVideoTrack();
  if (!video) throw new Error("No video track");
  expect((await video.computePacketStats()).packetCount).toBe(frames);
  expect(await video.computeDuration()).toBeCloseTo(frames / fps, 3);
});

it("cancelling removes the export frame at once, while it loads or starts", { timeout: 60_000 }, async () => {
  for (const stage of ["load", "init"] as const) {
    const controller = new AbortController();
    let frame: HTMLIFrameElement | null = null;
    let loaded = false;
    let initialised = false;
    onFrame = (added) => {
      frame = added;
      added.addEventListener("load", () => {
        loaded = true;
      });
      if (stage === "load") {
        controller.abort();
        return;
      }
      // Cancel as the exporter calls init(), which needs a few tasks to load the input. Wrapped on
      // load in the capture phase, before the exporter's listener on the frame reads the API.
      const wrapInit = (event: Event) => {
        if (event.target !== added) return;
        container.removeEventListener("load", wrapInit, true);
        const api = (added.contentWindow as (Window & { __swarmloom?: RenderApi }) | null)?.__swarmloom;
        if (!api) return;
        const init = api.init;
        api.init = (o) => {
          const started = init.call(api, o);
          started.then(
            () => {
              initialised = true;
            },
            () => undefined,
          );
          controller.abort();
          return started;
        };
      };
      container.addEventListener("load", wrapInit, true);
    };
    try {
      const error = await exportClip({ signal: controller.signal }).catch((e: unknown) => e);
      expect(error).toMatchObject({ name: "AbortError" });
      expect(frame).not.toBeNull();
      expect((frame as HTMLIFrameElement | null)?.isConnected).toBe(false);
      // The export gave up without waiting for the frame's load or init().
      expect([stage, stage === "load" ? loaded : initialised]).toEqual([stage, false]);
    } finally {
      onFrame = null;
    }
  }
});

it("cancelling while a frame, the sound or the file is made stops that work too", { timeout: 60_000 }, async () => {
  type Call = (this: VideoFileWriter, ...args: unknown[]) => Promise<unknown>;
  const writer = VideoFileWriter.prototype as unknown as Record<"addFrame" | "addAudio" | "finish", Call>;
  for (const method of ["addFrame", "addAudio", "finish"] as const) {
    const original = writer[method];
    const controller = new AbortController();
    let frame: HTMLIFrameElement | null = null;
    let call: Promise<unknown> | null = null;
    let calls = 0;
    onFrame = (added) => {
      frame = added;
    };
    // Cancel as the exporter starts the call, as Cancel would during "frames", "sound" or "finishing".
    writer[method] = function (...args) {
      calls++;
      // An encoder that never answers must not hold the export's own cancellation open.
      call = method === "addFrame" ? new Promise(() => {}) : original.apply(this, args);
      call.catch(() => undefined);
      controller.abort();
      return call;
    };
    try {
      const error = await exportClip({ signal: controller.signal, maxDurationMs: 500, hashFrames: false }).catch(
        (e: unknown) => e,
      );
      expect([method, error]).toMatchObject([method, { name: "AbortError" }]);
      expect((frame as HTMLIFrameElement | null)?.isConnected).toBe(false);
      // The writer gave up rather than encoding or muxing in the background.
      expect(call).not.toBeNull();
      expect(calls).toBe(1);
      if (method !== "addFrame") await expect(call).rejects.toBeDefined();
    } finally {
      writer[method] = original;
      onFrame = null;
    }
  }
});
