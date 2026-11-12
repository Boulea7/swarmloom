/**
 * Live recording of an element in the browser: Element Capture or Region Capture crops a capture of
 * the current tab to the element, MediaRecorder encodes it, and WebAudio is mixed in. This is a
 * real-time recording, not the frame-exact export of the CLI or of `@swarmloom/export/browser`
 * (which Studio's Export dialog uses).
 */

export interface RecordOptions {
  /** Container/codec, e.g. "video/webm;codecs=vp9,opus". Default: the best supported WebM, then MP4. */
  mimeType?: string;
  /** Capture frame rate. Default 30. */
  fps?: number;
  /** Default 8 Mbit/s. */
  videoBitsPerSecond?: number;
  /**
   * Sound to mix in:
   *  - an `AudioNode` (for example the master bus of a WebAudio graph), tapped through a
   *    `MediaStreamAudioDestinationNode` without changing what the user hears;
   *  - a `MediaStream` with an audio track;
   *  - "tab" (default): the tab's own audio, when the user leaves "share tab audio" on;
   *  - `false`: no audio.
   */
  audio?: AudioNode | MediaStream | "tab" | false;
  /** Aborting stops the recording; `result` still resolves with what was recorded. */
  signal?: AbortSignal;
}

/** A running recording started by {@link recordElement}. */
export interface Recording {
  readonly mimeType: string;
  /** Resolves with the video when recording ends: `stop()`, the user ending the share, or the signal. */
  readonly result: Promise<Blob>;
  /** Stops recording and resolves with the encoded video. */
  stop(): Promise<Blob>;
}

/** Why {@link recordElement} failed. */
export type RecordingErrorCode =
  /** The browser lacks getDisplayMedia, Element/Region Capture, MediaRecorder or a usable codec. */
  | "unsupported"
  /** The user cancelled the share dialog or denied permission. */
  | "denied"
  /** The user shared another tab, window or screen, which cannot be cropped to the element. */
  | "wrong-surface"
  /** Anything else (capture or encoder failure). */
  | "failed";

/** Error thrown by {@link recordElement}; `code` says why, the message says what to do. */
export class RecordingError extends Error {
  override readonly name = "RecordingError";
  readonly code: RecordingErrorCode;

  constructor(code: RecordingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
  }
}

interface RegionTarget {
  fromElement(element: Element): Promise<unknown>;
}

interface CroppableTrack extends MediaStreamTrack {
  cropTo?(target: unknown): Promise<void>;
  restrictTo?(target: unknown): Promise<void>;
}

interface RecorderLike extends EventTarget {
  readonly state: string;
  start(timeslice?: number): void;
  stop(): void;
}

interface RecorderCtor {
  new (stream: MediaStream, options?: MediaRecorderOptions): RecorderLike;
  isTypeSupported(type: string): boolean;
}

/** getDisplayMedia options, including the newer capture hints not yet in the DOM typings. */
export interface DisplayCaptureOptions {
  video: MediaTrackConstraints & { displaySurface?: string };
  audio: false | (MediaTrackConstraints & { suppressLocalAudioPlayback?: boolean });
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
}

/** Browser services the recorder uses; injectable for tests. */
export interface RecordEnv {
  getDisplayMedia?: (constraints: DisplayCaptureOptions) => Promise<MediaStream>;
  /** Element Capture (preferred: also excludes content painted over the element). */
  RestrictionTarget?: RegionTarget;
  /** Region Capture. */
  CropTarget?: RegionTarget;
  MediaRecorder?: RecorderCtor;
  createStream(tracks: MediaStreamTrack[]): MediaStream;
}

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
];
const UNSUPPORTED_HINT =
  "Live recording needs Chrome or Edge on desktop. Elsewhere, export with the CLI: npx swarmloom render <file> -o out.mp4";

function browserEnv(): RecordEnv {
  const g = globalThis as unknown as Record<string, unknown>;
  const devices = globalThis.navigator?.mediaDevices;
  return {
    getDisplayMedia: devices?.getDisplayMedia
      ? (c) => devices.getDisplayMedia(c as DisplayMediaStreamOptions)
      : undefined,
    RestrictionTarget: g.RestrictionTarget as RegionTarget | undefined,
    CropTarget: g.CropTarget as RegionTarget | undefined,
    MediaRecorder: g.MediaRecorder as RecorderCtor | undefined,
    createStream: (tracks) => new MediaStream(tracks),
  };
}

function regionApi(env: RecordEnv): { target: RegionTarget; method: "restrictTo" | "cropTo" } | null {
  if (typeof env.RestrictionTarget?.fromElement === "function")
    return { target: env.RestrictionTarget, method: "restrictTo" };
  if (typeof env.CropTarget?.fromElement === "function") return { target: env.CropTarget, method: "cropTo" };
  return null;
}

function pickMime(recorder: RecorderCtor, requested: string | undefined): string | null {
  if (requested) return recorder.isTypeSupported(requested) ? requested : null;
  return MIME_CANDIDATES.find((type) => recorder.isTypeSupported(type)) ?? null;
}

/** True when {@link recordElement} can work here (use it to decide between "Record" and the CLI hint). */
export function canRecordElement(env: RecordEnv = browserEnv()): boolean {
  return Boolean(env.getDisplayMedia && regionApi(env) && env.MediaRecorder && pickMime(env.MediaRecorder, undefined));
}

/** Audio tracks to record plus a cleanup for anything created to obtain them. */
function audioTracks(
  audio: RecordOptions["audio"],
  capture: MediaStream,
): { tracks: MediaStreamTrack[]; release(): void } {
  if (audio === false) return { tracks: [], release: () => undefined };
  if (audio === undefined || audio === "tab") return { tracks: capture.getAudioTracks(), release: () => undefined };
  if (typeof (audio as MediaStream).getAudioTracks === "function") {
    return { tracks: (audio as MediaStream).getAudioTracks(), release: () => undefined };
  }
  const node = audio as AudioNode;
  const destination = (node.context as AudioContext).createMediaStreamDestination();
  node.connect(destination);
  return {
    tracks: destination.stream.getAudioTracks(),
    release: () => {
      try {
        node.disconnect(destination);
      } catch {
        // Already disconnected (graph torn down by its owner).
      }
    },
  };
}

/**
 * Records `target` live: asks the user to share the current tab, crops the capture to the element
 * (Element Capture, else Region Capture), mixes in audio and encodes with MediaRecorder.
 *
 * This is a "quick recording" of what is on screen in real time; it is not deterministic (frame
 * timing follows the wall clock). For a reproducible video use the render page via the CLI.
 *
 * Call it from a user gesture (click handler): `getDisplayMedia` requires transient activation and
 * is invoked before the first `await`.
 *
 * @param target Element to record, usually the player host. Must be in the document.
 * @param opts Codec, frame rate, bitrate, audio source and abort signal.
 * @throws RecordingError `unsupported` (feature missing, with a CLI hint), `denied`, `wrong-surface` or `failed`.
 */
export function recordElement(target: Element, opts: RecordOptions = {}): Promise<Recording> {
  return recordWith(browserEnv(), target, opts);
}

/** {@link recordElement} with explicit browser services (tests, custom environments). */
export async function recordWith(env: RecordEnv, target: Element, opts: RecordOptions = {}): Promise<Recording> {
  if (!target?.isConnected) throw new TypeError("recordElement() needs an element that is in the document");
  const region = regionApi(env);
  const Recorder = env.MediaRecorder;
  if (!env.getDisplayMedia || !region || !Recorder) throw new RecordingError("unsupported", UNSUPPORTED_HINT);
  const mimeType = pickMime(Recorder, opts.mimeType);
  if (!mimeType) {
    const what = opts.mimeType ? `"${opts.mimeType}"` : "WebM or MP4";
    throw new RecordingError("unsupported", `This browser cannot record ${what}. ${UNSUPPORTED_HINT}`);
  }
  const fps = opts.fps ?? 30;
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) throw new RangeError(`fps must be within 1..120, got ${fps}`);

  // No await before this call: it must run inside the user gesture.
  const capturing = env.getDisplayMedia({
    video: { frameRate: fps, displaySurface: "browser" },
    audio: opts.audio === undefined || opts.audio === "tab" ? { suppressLocalAudioPlayback: false } : false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
  });
  const regionTarget = region.target.fromElement(target);

  let capture: MediaStream;
  try {
    capture = await capturing;
  } catch (error) {
    regionTarget.catch(() => undefined);
    const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
    throw new RecordingError(
      denied ? "denied" : "failed",
      denied ? "Recording was cancelled: screen sharing was not allowed." : "Could not start screen capture.",
      { cause: error },
    );
  }
  const stopCapture = (): void => {
    for (const track of capture.getTracks()) track.stop();
  };

  const video = capture.getVideoTracks()[0] as CroppableTrack | undefined;
  try {
    if (!video) throw new Error("no video track");
    const crop = video[region.method];
    if (typeof crop !== "function") throw new Error(`${region.method} is not available on the capture track`);
    await crop.call(video, await regionTarget);
  } catch (error) {
    stopCapture();
    throw new RecordingError(
      "wrong-surface",
      'Could not crop the capture to the element. Choose "This tab" in the sharing dialog and try again.',
      { cause: error },
    );
  }

  const audio = audioTracks(opts.audio, capture);
  let recorder: RecorderLike;
  try {
    const stream = env.createStream([video, ...audio.tracks.slice(0, 1)]);
    recorder = new Recorder(stream, {
      mimeType,
      videoBitsPerSecond: opts.videoBitsPerSecond ?? 8_000_000,
      audioBitsPerSecond: 128_000,
    });
  } catch (error) {
    audio.release();
    stopCapture();
    throw new RecordingError("failed", "Could not start the video encoder.", { cause: error });
  }

  const release = (): void => {
    audio.release();
    stopCapture();
    opts.signal?.removeEventListener("abort", stop);
  };
  const chunks: Blob[] = [];
  const result = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (e) => {
      const data = (e as BlobEvent).data;
      if (data && data.size > 0) chunks.push(data);
    });
    recorder.addEventListener("stop", () => {
      release();
      resolve(new Blob(chunks, { type: mimeType }));
    });
    recorder.addEventListener("error", (e) => {
      release();
      const cause = (e as ErrorEvent).error ?? e;
      reject(new RecordingError("failed", "Recording failed while encoding.", { cause }));
    });
  });
  // Callers observe `result` themselves; never report it as an unhandled rejection.
  result.catch(() => undefined);

  function stop(): Promise<Blob> {
    if (recorder.state !== "inactive") recorder.stop();
    return result;
  }
  // The user can end the share from the browser UI.
  video.addEventListener("ended", () => void stop(), { once: true });
  opts.signal?.addEventListener("abort", stop, { once: true });

  recorder.start(1000);
  if (opts.signal?.aborted) void stop();
  return { mimeType, result, stop };
}
