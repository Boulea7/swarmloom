#!/usr/bin/env node
// @ts-check
/**
 * Writes SHA256SUMS.txt for the release assets in a directory, in the format `sha256sum -c` reads.
 *
 * Usage: node scripts/release/checksums.mjs <dir>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runIfMain } from "./lib/cli.mjs";
import { listFiles } from "./lib/files.mjs";

export const CHECKSUM_FILE = "SHA256SUMS.txt";

/**
 * Returns one `<sha256>  <name>` line per file directly inside `dir` (sorted, the checksum file itself excluded).
 * @param {string} dir
 * @returns {string}
 */
export function checksumManifest(dir) {
  const files = listFiles(dir, (path) => !path.includes("/") && path !== CHECKSUM_FILE);
  if (files.length === 0) throw new Error(`No files to checksum in ${dir}`);
  return files
    .map(
      (name) =>
        `${createHash("sha256")
          .update(readFileSync(join(dir, name)))
          .digest("hex")}  ${name}\n`,
    )
    .join("");
}

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node scripts/release/checksums.mjs <dir>");
  const manifest = checksumManifest(dir);
  writeFileSync(join(dir, CHECKSUM_FILE), manifest);
  process.stdout.write(manifest);
}

runIfMain(import.meta.url, "checksums", main);
