import { type ChildProcess, spawn } from "node:child_process";
import { InterruptedError, RenderError } from "../errors";
import { trackChild } from "../util/owned";

const STDERR_TAIL = 4096;

type Exit = { code: number | null; signal: NodeJS.Signals | null; error?: Error };

/**
 * One ffmpeg invocation. Streaming jobs receive frames on stdin with backpressure:
 * {@link FfmpegJob.write} resolves only once the pipe can take more data, so a slow encoder
 * throttles capture instead of buffering frames in memory.
 */
export class FfmpegJob {
  private readonly child: ChildProcess;
  private readonly exited: Promise<Exit>;
  private exit: Exit | null = null;
  private stderrTail = "";
  private killed = false;

  private constructor(
    private readonly ffmpegPath: string,
    args: string[],
    stdin: boolean,
  ) {
    this.child = spawn(ffmpegPath, args, { stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"], windowsHide: true });
    trackChild(this.child);
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL);
    });
    // EPIPE when ffmpeg dies early; the exit status and stderr carry the real cause.
    this.child.stdin?.on("error", () => {});
    this.exited = new Promise<Exit>((resolve) => {
      this.child.once("error", (error) => resolve({ code: null, signal: null, error }));
      this.child.once("close", (code, signal) => resolve({ code, signal }));
    }).then((exit) => {
      this.exit = exit;
      return exit;
    });
  }

  /** Starts ffmpeg reading frames from stdin. */
  static stream(ffmpegPath: string, args: string[]): FfmpegJob {
    return new FfmpegJob(ffmpegPath, args, true);
  }

  /**
   * Runs a non-streaming ffmpeg pass to completion.
   * @throws RenderError on a non-zero exit; InterruptedError when `signal` aborts it.
   */
  static async run(ffmpegPath: string, args: string[], signal?: AbortSignal): Promise<void> {
    const job = new FfmpegJob(ffmpegPath, args, false);
    const onAbort = () => job.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await job.finish();
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Writes one encoded frame to stdin, waiting for the pipe to drain when its buffer is full.
   * @throws RenderError when ffmpeg has exited.
   */
  write(chunk: Uint8Array): Promise<void> {
    const stdin = this.child.stdin;
    if (this.exit || !stdin || stdin.destroyed) return this.failEarly();
    if (stdin.write(chunk)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onExit = () => {
        cleanup();
        this.failEarly().catch(reject);
      };
      const cleanup = () => {
        stdin.off("drain", onDrain);
        stdin.off("close", onExit);
      };
      stdin.once("drain", onDrain);
      stdin.once("close", onExit);
    });
  }

  /**
   * Closes stdin (if any) and waits for ffmpeg to exit.
   * @throws RenderError with ffmpeg's last stderr lines on failure; InterruptedError after kill().
   */
  async finish(): Promise<void> {
    this.child.stdin?.end();
    const exit = await this.exited;
    if (this.killed) throw new InterruptedError();
    if (exit.error) {
      throw new RenderError(`Could not start ffmpeg at ${this.ffmpegPath}: ${exit.error.message}`);
    }
    if (exit.code !== 0) throw this.failure(exit);
  }

  /** Stops ffmpeg immediately (abort and cleanup paths). */
  kill(): void {
    if (this.exit) return;
    this.killed = true;
    this.child.kill("SIGKILL");
  }

  /** Waits for the process to be gone after kill(). */
  async closed(): Promise<void> {
    await this.exited;
  }

  private async failEarly(): Promise<never> {
    const exit = await this.exited;
    if (this.killed) throw new InterruptedError();
    throw this.failure(exit);
  }

  private failure(exit: Exit): RenderError {
    const status = exit.signal ? `was killed by ${exit.signal}` : `exited with code ${exit.code}`;
    const detail = this.stderrTail.trim();
    return new RenderError(`ffmpeg ${status}${detail ? `:\n${detail}` : ""}`);
  }
}
