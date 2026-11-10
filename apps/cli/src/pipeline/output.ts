import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FfmpegCaps } from "../discovery/ffmpeg";
import { type OutputFormat, planMux, planVideo } from "./encode";
import { FfmpegJob } from "./ffmpeg-process";

/** Where captured frames go and how they become the final file (inside the temporary directory). */
export interface FrameWriter {
  /** Accepts the next frame; resolves when ready for another (backpressure). */
  write(frame: Uint8Array, index: number): Promise<void>;
  /** Completes encoding; resolves with the path of the finished video or frame directory. */
  finish(): Promise<string>;
  /** Adds the soundtrack, cut or padded to the video's `durationMs`; resolves with the new path. */
  addAudio(output: string, wav: Uint8Array, durationMs: number): Promise<string>;
  /** Stops any running encoder immediately and waits for it to exit. Safe to call more than once. */
  abort(): Promise<void>;
}

/** Writes numbered PNG frames and audio.wav into `<tmp>/frames`. */
export async function pngSequenceWriter(tmp: string): Promise<FrameWriter> {
  const dir = path.join(tmp, "frames");
  await mkdir(dir);
  return {
    write: (frame, index) => writeFile(path.join(dir, `frame-${String(index + 1).padStart(6, "0")}.png`), frame),
    finish: async () => dir,
    async addAudio(output, wav) {
      await writeFile(path.join(output, "audio.wav"), wav);
      return output;
    },
    abort: async () => {},
  };
}

/**
 * Streams frames into ffmpeg, then runs the format's follow-up passes and the audio mux.
 * Each pass is killed when `signal` aborts.
 */
export function ffmpegWriter(
  format: Exclude<OutputFormat, "png-seq">,
  opts: { ffmpegPath: string; caps: FfmpegCaps; fps: number; tmp: string; signal?: AbortSignal },
): FrameWriter {
  const plan = planVideo(format, opts.fps, opts.tmp, opts.caps);
  const stream = FfmpegJob.stream(opts.ffmpegPath, plan.stream);
  const kill = () => stream.kill();
  opts.signal?.addEventListener("abort", kill, { once: true });
  return {
    write: (frame) => stream.write(frame),
    async finish() {
      await stream.finish();
      for (const pass of plan.passes) await FfmpegJob.run(opts.ffmpegPath, pass, opts.signal);
      return plan.output;
    },
    async addAudio(output, wav, durationMs) {
      if (format !== "mp4" && format !== "webm") return output;
      const wavPath = path.join(opts.tmp, "audio.wav");
      await writeFile(wavPath, wav);
      const muxed = path.join(opts.tmp, `muxed${path.extname(output)}`);
      const args = planMux(format, { video: output, wav: wavPath, output: muxed, durationMs }, opts.caps);
      await FfmpegJob.run(opts.ffmpegPath, args, opts.signal);
      return muxed;
    },
    async abort() {
      opts.signal?.removeEventListener("abort", kill);
      stream.kill();
      await stream.closed();
    },
  };
}
