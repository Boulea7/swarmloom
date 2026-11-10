import { cp, mkdir, readdir, rename, rm, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

/** True when `dir` does not exist or has no entries. */
export async function isMissingOrEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/**
 * Moves a finished file or directory to its destination: an atomic rename when possible, a copy
 * across file systems otherwise. Files replace an existing destination; directories may only
 * replace an empty one.
 */
export async function moveIntoPlace(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTEMPTY" || code === "EEXIST" || code === "EPERM" || code === "EISDIR") {
      // Windows and some file systems refuse to rename over an empty directory.
      if (await isMissingOrEmptyDir(to)) {
        await rmdir(to).catch(() => {});
        await rename(from, to);
        return;
      }
      throw error;
    }
    if (code !== "EXDEV") throw error;
  }
  await cp(from, to, { recursive: true, force: true });
  await rm(from, { recursive: true, force: true });
}

/** Deletes a file, ignoring a missing one. */
export async function removeFile(file: string): Promise<void> {
  await unlink(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
