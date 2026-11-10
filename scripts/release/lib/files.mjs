// @ts-check
/** File-system helpers shared by the release scripts. */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Lists regular files under `root` as sorted, forward-slash relative paths.
 * Symbolic links and other special files are rejected so an archive never pulls in files from outside `root`.
 * @param {string} root
 * @param {(relativePath: string) => boolean} [include] return false to skip a file or directory
 * @returns {string[]}
 */
export function listFiles(root, include = () => true) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} relativeDir */
  const visit = (relativeDir) => {
    const names = readdirSync(join(root, relativeDir)).sort(compareCodeUnits);
    for (const name of names) {
      const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
      if (!include(relativePath)) continue;
      const stats = lstatSync(join(root, relativePath));
      if (stats.isDirectory()) visit(relativePath);
      else if (stats.isFile()) files.push(relativePath);
      else throw new Error(`Refusing to package ${relativePath}: not a regular file or directory`);
    }
  };
  visit("");
  return files;
}

/**
 * Locale-independent string order, so file lists (and therefore archives) sort the same on every machine.
 * @param {string} a
 * @param {string} b
 */
export function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
