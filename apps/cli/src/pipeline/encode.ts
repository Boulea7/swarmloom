import path from "node:path";
import type { FfmpegCaps } from "../discovery/ffmpeg";
import { MissingDependencyError } from "../errors";

export const OUTPUT_FORMATS = ["mp4", "webm", "gif", "webp", "png-seq"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** File extension of single-file formats (png-seq writes a directory). */
export const FORMAT_EXTENSION: Readonly<Record<OutputFormat, string | null>> = {
  mp4: ".mp4",
  webm: ".webm",
  gif: ".gif",
  webp: ".webp",
  "png-seq": null,
};

/** Whether the format carries the soundtrack (png-seq writes audio.wav next to the frames). */
export function formatHasAudio(format: OutputFormat): boolean {
  return format === "mp4" || format === "webm" || format === "png-seq";
}

export type FrameImageType = "jpeg" | "png";

/**
 * Screenshot encoding per output format: JPEG q90 is fast and fine for chroma-subsampled video,
 * PNG keeps flat colours exact where palettes or lossless frames are produced. `lossless` (set when a
 * capture manifest hashes the frames) always picks PNG, so the hashes describe exact pixels.
 */
export function frameImageType(format: OutputFormat, lossless = false): FrameImageType {
  return !lossless && (format === "mp4" || format === "webm") ? "jpeg" : "png";
}

export interface VideoPlan {
  /** Arguments of the ffmpeg process that reads frames from stdin. */
  stream: string[];
  /** Follow-up ffmpeg passes, run in order after the stream pass. */
  passes: string[][];
  /** File written by the last pass (inside the temp dir). */
  output: string;
}

const COMMON = ["-hide_banner", "-loglevel", "error", "-y"];

/** Even dimensions for 4:2:0, BT.709 limited range like every player expects, tagged accordingly. */
const YUV420_FILTER = "pad=ceil(iw/2)*2:ceil(ih/2)*2,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p";
const BT709_TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
/**
 * Matroska/WebM output flags: bitexact drops the random SegmentUID/TrackUIDs and the wall-clock DateUTC
 * the muxer writes otherwise, so the same frames and sound give the same file bytes (MP4 already does).
 */
const WEBM_CONTAINER = ["-fflags", "+bitexact"];

function need(caps: FfmpegCaps, kind: "encoders" | "filters", name: string, why: string): void {
  if (!caps[kind].has(name)) {
    throw new MissingDependencyError(
      `This ffmpeg build has no ${name} ${kind === "encoders" ? "encoder" : "filter"} (needed for ${why})`,
      "Install a full ffmpeg build (see swarmloom doctor), or choose another --format.",
    );
  }
}

function firstEncoder(caps: FfmpegCaps, names: readonly string[]): string | undefined {
  return names.find((name) => caps.encoders.has(name));
}

/**
 * Builds the ffmpeg passes that turn piped screenshots into the output video.
 *
 * @param format Output format other than png-seq.
 * @param fps Frame rate of the piped frames.
 * @param tmpDir Directory for intermediate and final files.
 * @throws MissingDependencyError when the ffmpeg build lacks a required encoder or filter.
 */
export function planVideo(
  format: Exclude<OutputFormat, "png-seq">,
  fps: number,
  tmpDir: string,
  caps: FfmpegCaps,
  imageType: FrameImageType = frameImageType(format),
): VideoPlan {
  const input = [
    ...COMMON,
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-c:v",
    imageType === "jpeg" ? "mjpeg" : "png",
    "-i",
    "pipe:0",
    "-an",
  ];
  const gop = String(Math.max(1, Math.round(fps * 2)));
  switch (format) {
    case "mp4": {
      need(caps, "encoders", "libx264", "MP4 (H.264)");
      const output = path.join(tmpDir, "video.mp4");
      // x264-params writes the VUI colour tags into the bitstream on every ffmpeg version; the generic
      // flags alone are overridden by untagged frame metadata in newer ffmpeg releases.
      const vui = ["-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709"];
      const encode = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", gop, ...vui];
      return {
        stream: [...input, "-vf", YUV420_FILTER, ...encode, ...BT709_TAGS, "-movflags", "+faststart", output],
        passes: [],
        output,
      };
    }
    case "webm": {
      need(caps, "encoders", "libvpx-vp9", "WebM (VP9)");
      const output = path.join(tmpDir, "video.webm");
      const encode = ["-c:v", "libvpx-vp9", "-crf", "31", "-b:v", "0", "-deadline", "good", "-cpu-used", "4"];
      return {
        stream: [
          ...input,
          "-vf",
          YUV420_FILTER,
          ...encode,
          "-row-mt",
          "1",
          "-g",
          gop,
          ...BT709_TAGS,
          ...WEBM_CONTAINER,
          output,
        ],
        passes: [],
        output,
      };
    }
    case "webp": {
      const encoder = firstEncoder(caps, ["libwebp_anim", "libwebp"]);
      if (!encoder) need(caps, "encoders", "libwebp_anim", "animated WebP");
      const output = path.join(tmpDir, "video.webp");
      const encode = ["-c:v", encoder ?? "libwebp_anim", "-lossless", "0", "-quality", "82", "-compression_level", "4"];
      return { stream: [...input, ...encode, "-loop", "0", "-f", "webp", output], passes: [], output };
    }
    case "gif": {
      need(caps, "filters", "palettegen", "GIF palettes");
      need(caps, "filters", "paletteuse", "GIF palettes");
      need(caps, "encoders", "ffv1", "the lossless intermediate of GIF export");
      // Frames go to a lossless intermediate first: palettegen needs every frame before the first
      // GIF frame can be written, and reading a file twice beats buffering raw frames in memory.
      const frames = path.join(tmpDir, "frames.mkv");
      const palette = path.join(tmpDir, "palette.png");
      const output = path.join(tmpDir, "video.gif");
      return {
        stream: [...input, "-c:v", "ffv1", frames],
        passes: [
          [
            ...COMMON,
            "-i",
            frames,
            "-vf",
            "palettegen=max_colors=256:stats_mode=full",
            "-frames:v",
            "1",
            "-update",
            "1",
            palette,
          ],
          [
            ...COMMON,
            "-i",
            frames,
            "-i",
            palette,
            "-lavfi",
            "[0:v][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
            "-loop",
            "0",
            "-f",
            "gif",
            output,
          ],
        ],
        output,
      };
    }
  }
}

export interface MuxFiles {
  video: string;
  wav: string;
  output: string;
  /** Exact video length (frames / fps), the length of the result. */
  durationMs: number;
}

/**
 * Builds the pass that adds the soundtrack to an encoded video. The video stream is copied; audio is
 * padded with silence and the result is cut at the explicit video duration (not `-shortest`, whose
 * cut point depends on muxer buffering), so the clip always ends on its last frame.
 *
 * @throws MissingDependencyError when no suitable audio encoder exists.
 */
export function planMux(format: "mp4" | "webm", files: MuxFiles, caps: FfmpegCaps): string[] {
  let audio: string[];
  if (format === "mp4") {
    need(caps, "encoders", "aac", "MP4 audio");
    audio = ["-c:a", "aac", "-b:a", "192k"];
  } else {
    const encoder = firstEncoder(caps, ["libopus", "libvorbis", "opus"]);
    if (!encoder) need(caps, "encoders", "libopus", "WebM audio");
    audio = ["-c:a", encoder ?? "libopus", "-b:a", "128k"];
    if (encoder === "opus") audio.push("-strict", "experimental");
  }
  const container = format === "mp4" ? ["-movflags", "+faststart"] : WEBM_CONTAINER;
  return [
    ...COMMON,
    "-i",
    files.video,
    "-i",
    files.wav,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    ...audio,
    "-af",
    "apad",
    "-t",
    (files.durationMs / 1000).toFixed(6),
    ...container,
    files.output,
  ];
}
