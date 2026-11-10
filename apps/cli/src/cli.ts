#!/usr/bin/env node
import { ExitCode } from "./errors";
import { processIo } from "./io";
import { run } from "./run";
import { releaseAll } from "./util/owned";

const io = processIo();
const controller = new AbortController();
let interrupts = 0;

/**
 * First Ctrl+C / SIGTERM aborts the running command, which closes the browser, stops ffmpeg and
 * removes temporary files. A second one exits at once, killing only the processes this CLI started
 * and deleting its temporary directories.
 */
function onSignal(): void {
  interrupts += 1;
  if (interrupts === 1) {
    io.tty?.write("\r\u001b[2K");
    io.err("Interrupted, cleaning up (press Ctrl+C again to force quit)");
    controller.abort();
    return;
  }
  releaseAll();
  process.exit(ExitCode.Interrupted);
}

process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
process.on("exit", releaseAll);

run(process.argv.slice(2), { io, signal: controller.signal }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    io.err(`swarmloom: unexpected failure: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = ExitCode.RenderFailed;
  },
);
