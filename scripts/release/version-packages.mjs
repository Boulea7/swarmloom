#!/usr/bin/env node
// @ts-check
/**
 * `pnpm version-packages`, the script of the version job in release.yml.
 *
 * Before the first release nothing is on npm and every package.json already holds the first version
 * (0.1.0), so `changeset version` would move past it (0.1.1 or 0.2.0) and the first release would never
 * be 0.1.0. While the product anchor (@swarmloom/core) has no version on the public npm registry, the
 * pending changesets describe changes that ship in that first version: this script deletes them instead
 * of versioning, so the Version Packages pull request only removes them. Merging it leaves no changeset,
 * and the release workflow moves on to publishing the version already in package.json.
 * Once the anchor is on npm, it runs `changeset version` unchanged.
 *
 * A registry answer other than 200 or 404 (network failure, outage) stops the script: guessing could
 * either drop changesets after the first release or bump past 0.1.0 before it.
 *
 * Usage: node scripts/release/version-packages.mjs [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runIfMain } from "./lib/cli.mjs";
import { isRecord } from "./lib/json.mjs";
import { PRODUCT_ANCHOR } from "./product-tag.mjs";

/** The registry releases go to (Trusted Publishing on npmjs.com), whatever registry installs use. */
export const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const REGISTRY_TIMEOUT_MS = 30_000;

/**
 * @typedef {(url: string, init: { headers: Record<string, string>; signal: AbortSignal }) =>
 *   Promise<{ status: number; json(): Promise<unknown> }>} Fetch
 */

/**
 * Whether any version of a package is on the registry.
 * @param {string} name
 * @param {Fetch} [fetchImpl]
 * @param {string} [registry]
 * @returns {Promise<boolean>}
 * @throws Error on any answer other than 200 with a packument or 404
 */
export async function isOnRegistry(name, fetchImpl = fetch, registry = PUBLIC_REGISTRY) {
  if (!/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(name)) throw new Error(`Invalid package name ${name}`);
  const url = new URL(name.replace("/", "%2f"), registry).href;
  const response = await fetchImpl(url, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });
  if (response.status === 404) return false;
  if (response.status !== 200) throw new Error(`${url} answered HTTP ${response.status}`);
  const body = await response.json();
  if (!isRecord(body) || !isRecord(body.versions)) throw new Error(`${url} returned no versions object`);
  return Object.keys(body.versions).length > 0;
}

/**
 * Changeset files waiting in `.changeset/` (every Markdown file except the README).
 * @param {string} dir the .changeset directory
 * @returns {string[]} file names, sorted
 */
export function pendingChangesets(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md")
    .sort();
}

/**
 * @typedef {object} VersionPlan
 * @property {"first-release" | "version"} mode
 * @property {string[]} removed changesets deleted for the first release
 * @property {number} status exit status of `changeset version` (0 in first-release mode)
 */

/**
 * Versions the packages, or folds pending changesets into the first release.
 * @param {object} options
 * @param {string} options.changesetDir
 * @param {boolean} options.published whether the product anchor is on npm already
 * @param {() => number} options.runVersion runs `changeset version` and returns its exit status
 * @param {boolean} [options.dryRun] report only, change nothing
 * @returns {VersionPlan}
 */
export function versionPackages({ changesetDir, published, runVersion, dryRun = false }) {
  if (published) return { mode: "version", removed: [], status: dryRun ? 0 : runVersion() };
  const removed = pendingChangesets(changesetDir);
  if (!dryRun) for (const name of removed) rmSync(join(changesetDir, name));
  return { mode: "first-release", removed, status: 0 };
}

/** Runs the local @changesets/cli binary with Node, which also works where `pnpm exec` needs a shell. */
function runChangesetVersion() {
  const bin = createRequire(import.meta.url).resolve("@changesets/cli/bin.js");
  const result = spawnSync(process.execPath, [bin, "version"], { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function main() {
  const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const published = await isOnRegistry(PRODUCT_ANCHOR);
  const plan = versionPackages({
    changesetDir: join(root, ".changeset"),
    published,
    runVersion: runChangesetVersion,
    dryRun: values["dry-run"],
  });
  if (plan.mode === "first-release") {
    const verb = values["dry-run"] ? "would remove" : "removed";
    console.log(
      `version-packages: ${PRODUCT_ANCHOR} is not on npm yet, so the first release publishes the versions in ` +
        `package.json; ${verb} ${plan.removed.length} pending changeset(s) it already includes: ` +
        `${plan.removed.join(", ") || "none"}`,
    );
  } else if (values["dry-run"]) {
    console.log("version-packages: would run `changeset version`");
  }
  return plan.status;
}

runIfMain(import.meta.url, "version-packages", main);
