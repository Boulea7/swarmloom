#!/usr/bin/env node
// @ts-check
/**
 * Packs a build folder (for example the bookmarklet install page in apps/bookmarklet/dist) into a deterministic
 * zip with the same rules as the extension archives: sorted entries, fixed timestamps, no dotfiles, no source maps.
 *
 * Usage: node scripts/release/pack-folder.mjs <folder> <out.zip>
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runIfMain } from "./lib/cli.mjs";
import { listFiles } from "./lib/files.mjs";
import { createZip } from "./lib/zip.mjs";
import { shouldPackage } from "./pack-extension.mjs";

/**
 * Zips every packaged file under `folder` (paths relative to it) and writes the archive to `outFile`.
 * @param {string} folder
 * @param {string} outFile
 * @returns {{ entries: number; bytes: number }}
 */
export function packFolder(folder, outFile) {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`${folder} is not a directory`);
  const files = listFiles(folder, shouldPackage);
  if (files.length === 0) throw new Error(`${folder} has no files to pack`);
  const archive = createZip(files.map((name) => ({ name, data: readFileSync(join(folder, name)) })));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, archive);
  return { entries: files.length, bytes: archive.length };
}

function main() {
  const [folder, outFile] = process.argv.slice(2);
  if (!folder || !outFile) throw new Error("usage: node scripts/release/pack-folder.mjs <folder> <out.zip>");
  const result = packFolder(resolve(folder), resolve(outFile));
  console.log(`${outFile} (${result.entries} files, ${result.bytes} bytes)`);
}

runIfMain(import.meta.url, "pack-folder", main);
