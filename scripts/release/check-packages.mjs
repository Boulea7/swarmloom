#!/usr/bin/env node
// @ts-check
/**
 * Pre-publish checks for workspace packages: the npm metadata a Trusted Publishing release relies on.
 * Errors block the release; warnings point at gaps that do not break publishing.
 *
 * Usage: node scripts/release/check-packages.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { parse as parseYaml } from "yaml";
import { runIfMain } from "./lib/cli.mjs";
import { compareCodeUnits } from "./lib/files.mjs";
import { isRecord, readJson } from "./lib/json.mjs";

export const REPOSITORY_URL = "git+https://github.com/Boulea7/swarmloom.git";
export const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** @typedef {{ dir: string; manifest: Record<string, unknown> }} WorkspacePackage */
/** @typedef {{ errors: string[]; warnings: string[] }} CheckResult */
/**
 * @typedef {object} CheckOptions
 * @property {(path: string) => boolean} [fileExists] relative to the package directory
 * @property {unknown} [defaultAccess] the `access` of .changeset/config.json; Changesets publishes with
 *   `publishConfig.access` when a package sets it and falls back to this value (npm's own default is restricted)
 */

/**
 * Expands the `packages` globs of pnpm-workspace.yaml. Only `dir` and `dir/*` patterns are supported,
 * which is all this repository uses; anything else fails loudly instead of being skipped.
 * @param {string} root repository root
 * @returns {string[]} package directories relative to root, forward slashes, sorted
 */
export function workspacePackageDirs(root) {
  const workspace = parseYaml(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"));
  const patterns = isRecord(workspace) ? workspace.packages : undefined;
  if (!Array.isArray(patterns) || !patterns.every((item) => typeof item === "string")) {
    throw new Error("pnpm-workspace.yaml: packages must be a list of strings");
  }
  /** @type {string[]} */
  const dirs = [];
  for (const pattern of patterns) {
    if (/^[\w.-]+(\/[\w.-]+)*\/\*$/.test(pattern)) {
      const parent = pattern.slice(0, -2);
      if (!existsSync(join(root, parent))) continue;
      for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
        const dir = posix.join(parent, entry.name);
        if (entry.isDirectory() && existsSync(join(root, dir, "package.json"))) dirs.push(dir);
      }
    } else if (/^[\w.-]+(\/[\w.-]+)*$/.test(pattern)) {
      if (existsSync(join(root, pattern, "package.json"))) dirs.push(pattern);
    } else {
      throw new Error(`pnpm-workspace.yaml: unsupported pattern ${JSON.stringify(pattern)}`);
    }
  }
  return dirs.sort(compareCodeUnits);
}

/**
 * Reads every workspace package manifest.
 * @param {string} root
 * @returns {WorkspacePackage[]}
 */
export function readWorkspacePackages(root) {
  return workspacePackageDirs(root).map((dir) => {
    const manifest = readJson(join(root, dir, "package.json"));
    if (!isRecord(manifest)) throw new Error(`${dir}/package.json is not a JSON object`);
    return { dir, manifest };
  });
}

/**
 * Checks one package. Private packages are versioned by Changesets but never published, so only
 * their name and version are checked.
 * @param {WorkspacePackage} pkg
 * @param {CheckOptions} [options]
 * @returns {CheckResult}
 */
export function checkPackage({ dir, manifest }, { fileExists = () => true, defaultAccess } = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const name = typeof manifest.name === "string" ? manifest.name : "";
  if (!name) errors.push(`${dir}: name is missing`);
  if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) {
    errors.push(`${dir}: version ${JSON.stringify(manifest.version)} is not semver`);
  }
  if (manifest.private === true) return { errors, warnings };

  const label = name || dir;
  const publishConfig = isRecord(manifest.publishConfig) ? manifest.publishConfig : {};
  // Same precedence as Changesets: publishConfig.access || config.access.
  const access = publishConfig.access || defaultAccess || "restricted";
  if (name.startsWith("@") && access !== "public") {
    errors.push(
      `${label}: would publish with access ${JSON.stringify(access)}; scoped packages need "public" ` +
        `(set "access": "public" in .changeset/config.json, or publishConfig.access in the package)`,
    );
  }
  if (publishConfig.registry !== undefined && publishConfig.registry !== PUBLIC_REGISTRY) {
    errors.push(`${label}: publishConfig.registry must be ${PUBLIC_REGISTRY} (got ${String(publishConfig.registry)})`);
  }
  if (manifest.license !== "MIT") errors.push(`${label}: license must be "MIT"`);
  const repository = isRecord(manifest.repository) ? manifest.repository : {};
  if (repository.url !== REPOSITORY_URL || repository.directory !== dir) {
    errors.push(`${label}: repository must be { "url": "${REPOSITORY_URL}", "directory": "${dir}" }`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    errors.push(`${label}: "files" must list what the tarball ships`);
  }
  if (manifest.exports === undefined && manifest.main === undefined && manifest.bin === undefined) {
    errors.push(`${label}: no entry point (exports, main or bin)`);
  }
  // No LICENSE check: pnpm pack adds the workspace root LICENSE to packages that have none.
  if (!fileExists("README.md")) warnings.push(`${label}: README.md missing; the npm page will be empty`);
  return { errors, warnings };
}

/**
 * Reads .changeset/config.json.
 * @param {string} root
 * @returns {Record<string, unknown>}
 */
export function readChangesetConfig(root) {
  const config = readJson(join(root, ".changeset", "config.json"));
  if (!isRecord(config)) throw new Error(".changeset/config.json is not a JSON object");
  return config;
}

/**
 * Private members of a fixed Changesets group share the group version but never reach npm; say so explicitly.
 * @param {Record<string, unknown>} config parsed .changeset/config.json
 * @param {readonly WorkspacePackage[]} packages
 * @returns {string[]}
 */
export function fixedGroupWarnings(config, packages) {
  const fixed = Array.isArray(config.fixed) ? config.fixed.flat() : [];
  return packages
    .filter((pkg) => pkg.manifest.private === true && fixed.includes(pkg.manifest.name))
    .map(
      (pkg) => `${String(pkg.manifest.name)} is private: it shares the fixed group version but is not published to npm`,
    );
}

function main() {
  const root = process.cwd();
  const config = readChangesetConfig(root);
  const packages = readWorkspacePackages(root);
  let errorCount = 0;
  for (const message of fixedGroupWarnings(config, packages)) console.warn(`warning: ${message}`);
  for (const pkg of packages) {
    const { errors, warnings } = checkPackage(pkg, {
      fileExists: (file) => existsSync(join(root, pkg.dir, file)),
      defaultAccess: config.access,
    });
    for (const message of warnings) console.warn(`warning: ${message}`);
    for (const message of errors) console.error(`error: ${message}`);
    errorCount += errors.length;
  }
  const publishable = packages.filter((pkg) => pkg.manifest.private !== true).length;
  console.log(`${packages.length} workspace packages, ${publishable} publishable, ${errorCount} error(s)`);
  return errorCount > 0 ? 1 : 0;
}

runIfMain(import.meta.url, "check-packages", main);
