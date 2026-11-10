#!/usr/bin/env node
// @ts-check
/**
 * Packs the unpacked extension builds (apps/extension/dist/<browser>/) into store-ready zips:
 * manifest.json at the archive root, sorted entries, fixed timestamps, no dotfiles and no source maps.
 * Firefox is one package for desktop and Android (one AMO listing). The safari zip holds the web resources
 * that safari-web-extension-packager (or App Store Connect's web packager) wraps into the container app.
 *
 * Usage: node scripts/release/pack-extension.mjs [--dist apps/extension/dist] [--out dist/release]
 *                                                [--browser all|chrome,edge,firefox,safari]   (default: all)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runIfMain } from "./lib/cli.mjs";
import { listFiles } from "./lib/files.mjs";
import { isRecord, readJson } from "./lib/json.mjs";
import { createZip } from "./lib/zip.mjs";

/** Browsers the extension build emits, in the order archives are written. */
export const BROWSERS = /** @type {const} */ (["chrome", "edge", "firefox", "safari"]);

/** Chrome's rule, which Firefox and Safari also accept: 1-4 dot-separated integers 0-65535, no leading zeros. */
const MANIFEST_VERSION_PATTERN = /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/;

/**
 * Checks the manifest fields stores reject first and returns the manifest version.
 * @param {string} browser
 * @param {unknown} manifest parsed manifest.json
 * @returns {string}
 */
export function validateManifest(browser, manifest) {
  if (!isRecord(manifest)) throw new Error(`${browser}: manifest.json is not a JSON object`);
  /** @type {string[]} */
  const problems = [];
  // Firefox ships an MV2 event page so one package also runs on Firefox for Android; the others are MV3.
  const allowedManifestVersions = browser === "firefox" ? [2, 3] : [3];
  if (!allowedManifestVersions.includes(/** @type {number} */ (manifest.manifest_version))) {
    problems.push(
      `manifest_version must be ${allowedManifestVersions.join(" or ")}, got ${JSON.stringify(manifest.manifest_version)}`,
    );
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") problems.push("name is missing");
  const version = manifest.version;
  const versionOk =
    typeof version === "string" &&
    MANIFEST_VERSION_PATTERN.test(version) &&
    version.split(".").every((part) => Number(part) <= 65535);
  if (!versionOk) {
    problems.push(`version must be 1-4 dot-separated integers (0-65535), got ${JSON.stringify(version)}`);
  }
  if ("key" in manifest) problems.push("key must not ship in store builds; stores assign the extension ID");
  if ("update_url" in manifest) problems.push("update_url must not ship in store builds; stores handle updates");
  if (browser === "firefox") {
    const settings = manifest.browser_specific_settings;
    const gecko = isRecord(settings) ? settings.gecko : undefined;
    if (!isRecord(gecko) || typeof gecko.id !== "string" || gecko.id === "") {
      problems.push("browser_specific_settings.gecko.id is required for AMO submissions");
    }
    if (!isRecord(isRecord(settings) ? settings.gecko_android : undefined)) {
      problems.push(
        "browser_specific_settings.gecko_android is required: the one Firefox package also targets Android",
      );
    }
  }
  if (problems.length > 0) throw new Error(`${browser}: invalid manifest.json\n  - ${problems.join("\n  - ")}`);
  return /** @type {string} */ (version);
}

/**
 * Store archives carry only what the extension loads: no dotfiles (.DS_Store, editor files) and no source maps.
 * @param {string} relativePath
 */
export function shouldPackage(relativePath) {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  return !name.startsWith(".") && !name.endsWith(".map");
}

/**
 * Packs one unpacked build directory.
 * @param {{ sourceDir: string; outDir: string; browser: string; baseName?: string }} options
 * @returns {{ file: string; version: string; entries: number; bytes: number }}
 */
export function packExtension({ sourceDir, outDir, browser, baseName = "swarmloom" }) {
  const manifestPath = join(sourceDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `${browser}: ${manifestPath} not found; build the extension first (pnpm --filter @swarmloom/extension... build)`,
    );
  }
  const version = validateManifest(browser, readJson(manifestPath));
  const files = listFiles(sourceDir, shouldPackage);
  const archive = createZip(files.map((name) => ({ name, data: readFileSync(join(sourceDir, name)) })));
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${baseName}-${browser}-${version}.zip`);
  writeFileSync(file, archive);
  return { file, version, entries: files.length, bytes: archive.length };
}

/**
 * Parses a comma-separated browser list ("all" selects every browser).
 * @param {string} value
 * @returns {string[]}
 */
export function parseBrowserList(value) {
  if (value === "all") return [...BROWSERS];
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const known = /** @type {readonly string[]} */ (BROWSERS);
  const unknown = list.filter((item) => !known.includes(item));
  if (list.length === 0 || unknown.length > 0) {
    throw new Error(`Unknown browser "${unknown.join(",") || value}". Expected all or: ${BROWSERS.join(", ")}`);
  }
  return list;
}

function main() {
  const { values } = parseArgs({
    options: {
      dist: { type: "string", default: "apps/extension/dist" },
      out: { type: "string", default: "dist/release" },
      browser: { type: "string", default: "all" },
    },
  });
  const distDir = resolve(values.dist);
  const outDir = resolve(values.out);
  for (const browser of parseBrowserList(values.browser)) {
    const result = packExtension({ sourceDir: join(distDir, browser), outDir, browser });
    console.log(`${result.file} (${result.entries} files, ${result.bytes} bytes)`);
  }
}

runIfMain(import.meta.url, "pack-extension", main);
