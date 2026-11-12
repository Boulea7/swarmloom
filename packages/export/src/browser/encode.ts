import {
  AudioBufferSource,
  type AudioCodec,
  canEncodeAudio,
  canEncodeVideo,
  EncodedAudioPacketSource,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  NullTarget,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  type VideoCodec,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from "mediabunny";
import { frameMicros } from "./schedule";
import { BlobSink, PART_BYTES, PacketSpool } from "./spool";

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

type Container = Mp4OutputFormat | WebMOutputFormat;

/**
 * The container of a plan. The file's MP4 reserves room for its index ahead of the media (fast start,
 * like the CLI's `-movflags +faststart`) so the media can stream in behind it; the room is an upper
 * bound from the packet counts (about 35 bytes per frame, 45 per audio packet) and what the index
 * leaves over stays as a `free` box. The encoding passes write nowhere and only hand packets on.
 */
function containerFormat(plan: EncodingPlan, file: boolean): Container {
  if (plan.container === "webm") return new WebMOutputFormat();
  return new Mp4OutputFormat({ fastStart: file ? "reserve" : false });
}

async function cancelOutput(output: Output | null): Promise<void> {
  if (!output || output.state === "canceled" || output.state === "finalized") return;
  await output.cancel();
}

/**
 * One output file: raw RGBA frames in, an encoded MP4 or WebM out. Frames get exact timestamps
 * from their index (`round(n * 1e6 / fps)` microseconds); the soundtrack is one AudioBuffer added
 * after the frames, starting at 0.
 *
 * The video does not pile up in script memory however long it is: encoded frames wait in Blob parts
 * ({@link PacketSpool}) rather than in the muxer, which would hold them until the soundtrack arrives
 * to interleave it, and the file is written into Blob parts as it is muxed ({@link BlobSink}).
 */
export class VideoFileWriter {
  readonly plan: EncodingPlan;
  /** Encodes the frames; its muxer writes nowhere, the packets go to {@link #frames}. */
  readonly #encoder: Output<Container, NullTarget>;
  readonly #video: VideoSampleSource;
  readonly #frames = new PacketSpool<EncodedVideoChunkMetadata>();
  #sound: PacketSpool<EncodedAudioChunkMetadata> | null = null;
  #soundOutput: Output | null = null;
  #muxer: Output | null = null;
  readonly #fps: number;
  readonly #width: number;
  readonly #height: number;
  #started = false;

  constructor(plan: EncodingPlan, width: number, height: number, fps: number) {
    this.plan = plan;
    this.#fps = fps;
    this.#width = width;
    this.#height = height;
    this.#encoder = new Output({ format: containerFormat(plan, false), target: new NullTarget() });
    this.#video = new VideoSampleSource({
      codec: plan.video,
      quality: QUALITY_HIGH,
      sizeChangeBehavior: "deny",
      onEncodedPacket: (packet, meta) => this.#frames.add(packet, meta),
    });
    this.#encoder.addVideoTrack(this.#video, { frameRate: fps });
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.#encoder.start();
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

  /** Encodes the soundtrack; only when the plan has an audio codec. The buffer can go afterwards. */
  async addAudio(buffer: AudioBuffer): Promise<void> {
    if (!this.plan.audio) return;
    const sound = new PacketSpool<EncodedAudioChunkMetadata>();
    const output = new Output({ format: containerFormat(this.plan, false), target: new NullTarget() });
    this.#soundOutput = output;
    const source = new AudioBufferSource({
      codec: this.plan.audio,
      quality: QUALITY_HIGH,
      onEncodedPacket: (packet, meta) => sound.add(packet, meta),
    });
    output.addAudioTrack(source);
    await output.start();
    await source.add(buffer);
    await output.finalize();
    this.#sound = sound;
  }

  async finish(): Promise<Blob> {
    this.#video.close();
    await this.#encoder.finalize();
    const sink = new BlobSink();
    await this.#mux(new StreamTarget(sink.writable, { chunked: true, chunkSize: PART_BYTES }));
    if (sink.size === 0) throw new Error("The video file is empty");
    return sink.blob(this.plan.mimeType);
  }

  /** Writes the spooled packets into the file, by time, so the muxer's interleaving queue stays short. */
  async #mux(target: StreamTarget): Promise<void> {
    const output = new Output({ format: containerFormat(this.plan, true), target });
    this.#muxer = output;
    output.setMetadataTags({ creationTime: CREATION_TIME });
    const video = new EncodedVideoPacketSource(this.plan.video);
    output.addVideoTrack(video, { frameRate: this.#fps, maximumPacketCount: this.#frames.count });
    const sound = this.#sound;
    const audio = sound && this.plan.audio ? new EncodedAudioPacketSource(this.plan.audio) : null;
    if (sound && audio) output.addAudioTrack(audio, { maximumPacketCount: sound.count });
    await output.start();

    const sounds = audio ? sound?.packets() : undefined;
    let pending = await sounds?.next();
    let firstSound = true;
    const addSoundUntil = async (time: number) => {
      while (audio && pending && !pending.done && pending.value.timestamp <= time) {
        await audio.add(pending.value, firstSound ? sound?.meta : undefined);
        firstSound = false;
        pending = await sounds?.next();
      }
    };
    let firstFrame = true;
    for await (const packet of this.#frames.packets()) {
      await addSoundUntil(packet.timestamp);
      await video.add(packet, firstFrame ? this.#frames.meta : undefined);
      firstFrame = false;
    }
    await addSoundUntil(Number.POSITIVE_INFINITY);
    video.close();
    audio?.close();
    await output.finalize();
  }

  /** Stops encoding and drops what was written. */
  async cancel(): Promise<void> {
    await cancelOutput(this.#encoder);
    await cancelOutput(this.#soundOutput);
    await cancelOutput(this.#muxer);
  }
}
