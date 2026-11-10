import type { ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

/**
 * Resources this CLI created that must not outlive it: ffmpeg children and temporary directories.
 * On a forced exit (second Ctrl+C) they are released synchronously. Only processes registered here
 * are ever signalled: the CLI never kills by name or port. The browser is owned by Playwright, which
 * closes it on `browser.close()` and kills it when this process exits.
 */
const children = new Set<ChildProcess>();
const tempDirs = new Set<string>();

/** Registers a child until it exits. */
export function trackChild(child: ChildProcess): void {
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", () => children.delete(child));
}

/** Registers a temporary directory; returns a function that removes it and unregisters it. */
export function trackTempDir(dir: string): () => void {
  tempDirs.add(dir);
  return () => {
    tempDirs.delete(dir);
    rmSync(dir, { recursive: true, force: true });
  };
}

/** Kills every registered child and deletes every registered directory. Safe in signal and exit handlers. */
export function releaseAll(): void {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  children.clear();
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort while exiting; nothing else can be done here.
    }
  }
  tempDirs.clear();
}
