// Source stamp of the CLI render page: the workspace files (and the lockfile) dist/render was built
// from, by content hash. The render build writes it; the CLI build reads it to tell a render page
// built from this checkout from a stale one.
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where the stamp lives, relative to the package: beside dist/render, so it never ships. */
export const STAMP = "dist/render.sources.json";
/** The built page the stamp vouches for, relative to the package. */
const PAGE = "dist/render/index.html";

async function hash(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

/** Writes the stamp of `files` (absolute paths; unreadable ones are left out) for the package at `pkgDir`. */
export async function writeStamp(pkgDir, files) {
  const sums = {};
  for (const file of [...new Set(files)].sort()) {
    const sum = await hash(file).catch(() => null);
    if (sum) sums[path.relative(pkgDir, file).replaceAll("\\", "/")] = sum;
  }
  await writeFile(path.join(pkgDir, STAMP), `${JSON.stringify({ files: sums }, null, 2)}\n`);
}

/**
 * Stamped files that changed or are gone since the render page was built, `[STAMP]` when it has no stamp,
 * or the page itself when it is gone (dist/render deleted but the stamp kept).
 */
export async function staleFiles(pkgDir) {
  let stamp;
  try {
    stamp = JSON.parse(await readFile(path.join(pkgDir, STAMP), "utf8"));
  } catch {
    return [STAMP];
  }
  const built = await access(path.join(pkgDir, PAGE)).then(
    () => true,
    () => false,
  );
  if (!built) return [PAGE];
  const stale = [];
  for (const [file, sum] of Object.entries(stamp.files ?? {})) {
    if ((await hash(path.join(pkgDir, file)).catch(() => null)) !== sum) stale.push(file);
  }
  return stale;
}
