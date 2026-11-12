import { renderOffline } from "@swarmloom/core";
import { type ShadowWatch, watchShadowRoots } from "../render/live";
import type { RenderApi, RenderInfo, RenderInit, RenderInput } from "../render/protocol";
import { CHANNELS, type CodecProbe, type EncodingPlan, planEncoding, SAMPLE_RATE, VideoFileWriter } from "./encode";
import { FRAME_ATTRIBUTE } from "./marker";
import { type ColorScheme, type MediaPin, pinMediaFeatures } from "./media";
import { type FontWatch, watchFontFaces } from "./raster/fonts";
import { FrameRasterizer } from "./raster/rasterize";
import { type FrameProgress, runFrameSchedule } from "./schedule";

/** Player settings of an export: the CLI's `render` flags. */
export type ExportSettings = Omit<RenderInit, "input" | "width" | "height" | "fps" | "blueprint" | "cues">;

/** Options of {@link exportVideo}. */
export interface BrowserExportOptions {
  /** The source, as the CLI's render page takes it. */
  input: RenderInput;
  /** Frame size in CSS px; the video has the same size in pixels. */
  width: number;
  height: number;
  fps: number;
  settings?: ExportSettings;
  /**
   * What document adapters may fetch, and what the frame rasterizer may fetch to embed: https
   * images and fonts (default) or nothing from the web.
   */
  network?: "https" | "none";
  /** Stop after this much video even if the build is not done, ms. Default 600000 (10 min). */
  maxDurationMs?: number;
  signal?: AbortSignal;
  onProgress?(progress: ExportProgress): void;
  /** Recoverable problems: a resource left blank, sound left out. */
  onWarning?(message: string): void;
  /** Element the hidden export frame is added to. Default `document.body`. */
  container?: HTMLElement;
  /** Codec checks (tests). Default WebCodecs through Mediabunny. */
  probe?: CodecProbe;
  /**
   * Hash every frame's RGBA pixels into {@link BrowserExportResult.frameSha256} (tests, evidence),
   * as the CLI does for `--manifest-out`. Off by default: it reads each frame back from the canvas.
   */
  hashFrames?: boolean;
}

/** Progress of an export. */
export interface ExportProgress extends FrameProgress {
  phase: "starting" | "frames" | "sound" | "finishing";
}

/** A finished export. */
export interface BrowserExportResult {
  blob: Blob;
  plan: EncodingPlan;
  /** File extension for {@link EncodingPlan.container}. */
  extension: "mp4" | "webm";
  frames: number;
  durationMs: number;
  /** False when `maxDurationMs` cut the build short. */
  finished: boolean;
  /** Sound was asked for but this browser cannot encode it: the video is silent. */
  soundUnsupported: boolean;
  /**
   * SHA-256 (hex) of every frame's RGBA pixels before encoding, in order; empty unless
   * `hashFrames` was set, or without Web Crypto.
   */
  frameSha256: string[];
  info: RenderInfo;
  warnings: string[];
}

const DEFAULT_MAX_DURATION = 600_000;
/** Longest wait for the export frame to start. */
const FRAME_START_TIMEOUT = 60_000;
const FRAME_STYLE = "position:fixed;left:0;top:0;border:0;margin:0;padding:0;opacity:0;pointer-events:none;z-index:-1;";

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * The render page document: the CLI's render/index.html, with the frame module as its script. That
 * page takes both schemes and gets the one its browser emulates; this one takes only `scheme`, so the
 * browser's own colours do not follow the host.
 */
function frameDocument(moduleUrl: string, scheme: ColorScheme): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<meta name="color-scheme" content="${scheme}">` +
    "<style>html,body{margin:0;padding:0;overflow:hidden;background:#fff}</style>" +
    `<script type="module" src="${escapeHtmlAttr(moduleUrl)}"></script></head><body></body></html>`
  );
}

interface OpenFrame {
  frame: HTMLIFrameElement;
  win: Window & typeof globalThis;
  api: RenderApi;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The export was cancelled.", "AbortError");
}

/**
 * Settles as `work` does, or rejects with the signal's reason as soon as it aborts. For work in the
 * export frame, which takes no signal: the export then removes the frame, and that stops the work.
 */
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Adds the hidden frame and waits until its render page has installed `window.__swarmloom`. When
 * the signal aborts meanwhile, the frame is removed at once, which stops its loading.
 */
async function openFrame(o: BrowserExportOptions, container: HTMLElement, scheme: ColorScheme): Promise<OpenFrame> {
  const { FRAME_MODULE_URL } = await import("./frame");
  if (o.signal?.aborted) throw abortError(o.signal);
  const frame = container.ownerDocument.createElement("iframe");
  frame.setAttribute(FRAME_ATTRIBUTE, o.network ?? "https");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.title = "SwarmLoom export";
  frame.style.cssText = `${FRAME_STYLE}width:${o.width}px;height:${o.height}px;`;
  frame.srcdoc = frameDocument(FRAME_MODULE_URL, scheme);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loaded = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("The export frame did not start")), FRAME_START_TIMEOUT);
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  container.append(frame);
  try {
    await unlessAborted(loaded, o.signal);
    const win = frame.contentWindow as (Window & typeof globalThis) | null;
    const api = win?.__swarmloom;
    if (!win || !api) throw new Error("The export frame did not start");
    return { frame, win, api };
  } catch (error) {
    frame.remove();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Renders at one device pixel per CSS px, as the CLI does at `--scale 1`. */
function pinPixelRatio(win: Window): void {
  Object.defineProperty(win, "devicePixelRatio", { configurable: true, get: () => 1 });
}

async function sha256(bytes: Uint8ClampedArray<ArrayBuffer>): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", bytes);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Exports a video in the page, frame for frame the same as `swarmloom render`: a hidden frame runs
 * the CLI's render page (same formats, player options and virtual clock steps), each frame is drawn
 * without a screenshot ({@link FrameRasterizer}) and encoded with WebCodecs into MP4 (H.264)
 * or WebM (VP9) through Mediabunny. The soundtrack is the run's sound log rendered offline, as AAC or
 * Opus when the browser can encode it, else the video is silent.
 *
 * The page stays responsive: the loop yields to the event loop between frames, and the snapshot of a
 * frame pauses every few milliseconds (cancelling takes effect at the next pause). Drawing a frame
 * decodes its image in one task, which grows with the web fonts it embeds (in Chromium about 40 ms
 * per MB of the faces the frame's text uses).
 *
 * @throws UnsupportedExportError when the browser cannot encode video; the signal's reason when
 *   cancelled; the render page's errors (unreadable input).
 */
export async function exportVideo(o: BrowserExportOptions): Promise<BrowserExportResult> {
  const { width, height, fps, signal } = o;
  const settings = o.settings ?? {};
  const sound = settings.sound !== false;
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    o.onWarning?.(message);
  };
  const report = (phase: ExportProgress["phase"], p?: FrameProgress) =>
    o.onProgress?.({
      phase,
      frames: p?.frames ?? 0,
      totalFrames: p?.totalFrames ?? 0,
      built: p?.built ?? 0,
      layers: p?.layers ?? 0,
      elapsedMs: p?.elapsedMs ?? 0,
      etaMs: p?.etaMs ?? null,
    });

  if (signal?.aborted) throw abortError(signal);
  report("starting");
  const plan = await planEncoding(width, height, fps, sound, o.probe);
  if (signal?.aborted) throw abortError(signal);
  const soundUnsupported = sound && plan.audio === null;
  if (soundUnsupported) warn("This browser cannot encode sound, so the video is silent");

  const container = o.container ?? document.body;
  // The CLI's browser emulates dark for theme "dark" and light otherwise ("auto" included), whatever
  // the host's system setting.
  const scheme: ColorScheme = settings.theme === "dark" ? "dark" : "light";
  let opened: OpenFrame | null = null;
  let shadows: ShadowWatch | null = null;
  let fonts: FontWatch | null = null;
  let media: MediaPin | null = null;
  let writer: VideoFileWriter | null = null;
  let finished = false;
  try {
    opened = await openFrame(o, container, scheme);
    const { win, api } = opened;
    // Watch before init(): the stage attaches its closed shadow roots and adapters register fonts there.
    shadows = watchShadowRoots(win);
    fonts = watchFontFaces(win);
    pinPixelRatio(win);
    const pinned = pinMediaFeatures(win, shadows, { scheme, width, height });
    media = pinned;
    const tail = settings.tail ?? 2500;
    // Loading the input can take long; cancelling removes the frame (below) rather than waiting.
    const info = await unlessAborted(api.init({ ...settings, input: o.input, width, height, fps, tail }), signal);

    const rasterizer = new FrameRasterizer({
      document: win.document,
      width,
      height,
      shadows,
      fonts,
      network: o.network ?? "https",
      onWarning: warn,
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const hash = o.hashFrames === true;
    // Read back only for hashing; otherwise the encoder takes the canvas itself.
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: hash });
    if (!ctx) throw new Error("A 2D canvas is not available");
    writer = new VideoFileWriter(plan, width, height, fps);
    await writer.start();
    const out = writer;

    const frameSha256: string[] = [];
    const maxFrames = Math.max(1, Math.round(((o.maxDurationMs ?? DEFAULT_MAX_DURATION) * fps) / 1000));
    const result = await runFrameSchedule(
      {
        step: (ms) => api.step(ms),
        capture: async (index) => {
          pinned.sweep();
          await rasterizer.draw(ctx, signal);
          if (!hash) {
            await out.addFrame(index, canvas);
            return;
          }
          const pixels = ctx.getImageData(0, 0, width, height).data;
          const digest = await sha256(pixels);
          if (digest) frameSha256.push(digest);
          await out.addFrame(index, pixels);
        },
      },
      {
        fps,
        maxFrames,
        estimatedFrames: Math.ceil((info.estimatedMs * fps) / 1000) + 1,
        tailMs: tail,
        signal,
        onProgress: (p) => report("frames", p),
      },
    );

    if (plan.audio) {
      report("sound");
      const events = await api.soundLog();
      const soundOptions = { enabled: true, pack: settings.pack, bpm: settings.bpm, beatSync: true };
      const buffer = await renderOffline(events, result.durationMs, {
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        sound: soundOptions,
      });
      if (signal?.aborted) throw abortError(signal);
      await out.addAudio(buffer);
    }
    report("finishing");
    const blob = await out.finish();
    finished = true;
    return {
      blob,
      plan,
      extension: plan.container,
      frames: result.frames,
      durationMs: result.durationMs,
      finished: result.finished,
      soundUnsupported,
      frameSha256,
      info,
      warnings,
    };
  } finally {
    if (!finished) await writer?.cancel().catch(() => undefined);
    try {
      opened?.api.dispose();
    } finally {
      shadows?.stop();
      fonts?.stop();
      media?.stop();
      opened?.frame.remove();
    }
  }
}
