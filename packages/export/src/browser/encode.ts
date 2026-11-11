import {
  AudioBufferSource,
  type AudioCodec,
  BufferTarget,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type VideoCodec,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from "mediabunny";
import { frameMicros } from "./schedule";

/** Sample rate of the soundtrack (the CLI's WAV uses the same). */
export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;

/** Container, codecs and file details chosen for this browser. */
export interface EncodingPlan {
  container: "mp4" | "webm";
  video: Extract<VideoCodec, "avc" | "vp9">;
  /** Null when sound is off or the browser cannot encode a codec the container takes. */
  audio: Extract<AudioCodec, "aac" | "opus"> | null;
  mimeType: string;
}

/** Codec checks, injectable for tests; default Mediabunny's (WebCodecs `isConfigSupported`). */
export interface CodecProbe {
  video(codec: "avc" | "vp9", width: number, height: number, fps: number): Promise<boolean>;
  audio(codec: "aac" | "opus"): Promise<boolean>;
}

export const webCodecsProbe: CodecProbe = {
  video: (codec, width, height, fps) => canEncodeVideo(codec, { width, height, frameRate: fps, quality: QUALITY_HIGH }),
  audio: (codec) =>
    canEncodeAudio(codec, { numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE, quality: QUALITY_HIGH }),
};

/** True when the browser has the WebCodecs encoders the export needs at all. */
export function hasWebCodecs(scope: object = globalThis): boolean {
  const s = scope as { VideoEncoder?: unknown; VideoFrame?: unknown };
  return typeof s.VideoEncoder === "function" && typeof s.VideoFrame === "function";
}

/** Thrown when this browser cannot encode video at all; the CLI makes the same file. */
export class UnsupportedExportError extends Error {
  override readonly name = "UnsupportedExportError";
}

/**
 * Picks H.264 in MP4 when the browser can encode it at this size, else VP9 in WebM. Sound goes in as
 * AAC (MP4) or Opus (either container) when an encoder exists, else the video is silent.
 *
 * @throws UnsupportedExportError when neither video codec can be encoded.
 */
export async function planEncoding(
  width: number,
  height: number,
  fps: number,
  sound: boolean,
  probe: CodecProbe = webCodecsProbe,
): Promise<EncodingPlan> {
  let container: EncodingPlan["container"];
  let video: EncodingPlan["video"];
  if (await probe.video("avc", width, height, fps)) {
    container = "mp4";
    video = "avc";
  } else if (await probe.video("vp9", width, height, fps)) {
    container = "webm";
    video = "vp9";
  } else {
    throw new UnsupportedExportError(`This browser cannot encode ${width} x ${height} video (H.264 or VP9)`);
  }
  let audio: EncodingPlan["audio"] = null;
  if (sound) {
    const candidates: ("aac" | "opus")[] = container === "mp4" ? ["aac", "opus"] : ["opus"];
    for (const codec of candidates) {
      if (await probe.audio(codec)) {
        audio = codec;
        break;
      }
    }
  }
  return { container, video, audio, mimeType: container === "mp4" ? "video/mp4" : "video/webm" };
}

/** Fixed container date, so files carry no wall-clock metadata. */
const CREATION_TIME = new Date(Date.UTC(2001, 0, 1));

/**
 * One output file: raw RGBA frames in, an encoded MP4 or WebM out. Frames get exact timestamps
 * from their index (`round(n * 1e6 / fps)` microseconds); the soundtrack is one AudioBuffer added
 * after the frames, starting at 0.
 */
export class VideoFileWriter {
  readonly plan: EncodingPlan;
  readonly #output: Output<Mp4OutputFormat | WebMOutputFormat, BufferTarget>;
  readonly #video: VideoSampleSource;
  readonly #audio: AudioBufferSource | null;
  readonly #fps: number;
  readonly #width: number;
  readonly #height: number;
  #started = false;

  constructor(plan: EncodingPlan, width: number, height: number, fps: number) {
    this.plan = plan;
    this.#fps = fps;
    this.#width = width;
    this.#height = height;
    const format = plan.container === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat();
    this.#output = new Output({ format, target: new BufferTarget() });
    this.#output.setMetadataTags({ creationTime: CREATION_TIME });
    this.#video = new VideoSampleSource({ codec: plan.video, quality: QUALITY_HIGH, sizeChangeBehavior: "deny" });
    this.#output.addVideoTrack(this.#video, { frameRate: fps });
    this.#audio = plan.audio ? new AudioBufferSource({ codec: plan.audio, quality: QUALITY_HIGH }) : null;
    if (this.#audio) this.#output.addAudioTrack(this.#audio);
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.#output.start();
  }

  /**
   * Encodes frame `index` from tightly packed RGBA pixels or straight from a canvas of the video's
   * size (no readback into script); resolves when the encoder can take more.
   */
  async addFrame(index: number, frame: Uint8ClampedArray | HTMLCanvasElement | OffscreenCanvas): Promise<void> {
    const micros = frameMicros(index, this.#fps);
    const timestamp = micros / 1e6;
    const duration = (frameMicros(index + 1, this.#fps) - micros) / 1e6;
    const sample = ArrayBuffer.isView(frame)
      ? new VideoSample(frame, {
          format: "RGBA",
          codedWidth: this.#width,
          codedHeight: this.#height,
          timestamp,
          duration,
        })
      : new VideoSample(frame, { timestamp, duration });
    try {
      await this.#video.add(sample);
    } finally {
      sample.close();
    }
  }

  /** Adds the soundtrack; only when the plan has an audio codec. */
  async addAudio(buffer: AudioBuffer): Promise<void> {
    if (!this.#audio) return;
    await this.#audio.add(buffer);
  }

  async finish(): Promise<Blob> {
    this.#video.close();
    this.#audio?.close();
    await this.#output.finalize();
    const bytes = this.#output.target.buffer;
    if (!bytes) throw new Error("The video file is empty");
    return new Blob([bytes], { type: this.plan.mimeType });
  }

  /** Stops encoding and drops what was written. */
  async cancel(): Promise<void> {
    if (this.#output.state === "canceled" || this.#output.state === "finalized") return;
    await this.#output.cancel();
  }
}
