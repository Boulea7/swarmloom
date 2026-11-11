#!/usr/bin/env node
/**
 * Downloads the site's videos, posters and captions from the GitHub release `media-v1` into
 * `public/media/`, so large media never lives in git. Runs before every `vite build`.
 *
 * Release asset names are flat; they map to files under public/media/ like this:
 *   promo-zh.mp4, promo-en.mp4, promo-poster.avif, promo-zh.vtt, promo-en.vtt  -> same name
 *   clips-<format>.mp4 | clips-<format>.webm | clips-<format>.avif            -> clips/<format>.<ext>
 *
 * Release ids match the media source folders; doc/docx share the site's word slot (DOCX wins),
 * sheet maps to sheets, and three maps to model. Unknown names are ignored. A missing release or
 * a failed download is not an error for local builds: the site falls back to its animated SVG
 * scenes. Set SWARMLOOM_REQUIRE_MEDIA=1 (the Pages deploy does) to exit non-zero instead,
 * SWARMLOOM_SKIP_MEDIA=1 to skip, and GITHUB_TOKEN (or GH_TOKEN) to raise the API rate limit in CI.
 */

import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_SLUG = "Boulea7/swarmloom";
export const MEDIA_TAG = "media-v1";

/** Format ids with a clip slot (must match src/content/formats.ts FORMAT_IDS; a unit test checks). */
export const CLIP_FORMATS = [
  "web",
  "html",
  "svg",
  "markdown",
  "word",
  "pdf",
  "slides",
  "sheets",
  "code",
  "image",
  "model",
];

const CLIP_SOURCE_ALIASES = { doc: "word", docx: "word", sheet: "sheets", three: "model" };

const MB = 1024 * 1024;
const PROMO = /^promo-(zh|en)\.mp4$/;
const CAPTIONS = /^promo-(zh|en)\.vtt$/;
const CLIP = /^clips-([a-z]+)\.(mp4|webm|avif)$/;

/**
 * Maps a release asset name to its path under public/media/ and a size cap, or null when the
 * asset is not one the site uses.
 * @param {unknown} name
 * @returns {{ path: string, maxBytes: number } | null}
 */
export function assetTarget(name) {
  if (typeof name !== "string" || name.length > 64) return null;
  if (PROMO.test(name)) return { path: name, maxBytes: 150 * MB };
  if (CAPTIONS.test(name)) return { path: name, maxBytes: MB };
  if (name === "promo-poster.avif") return { path: name, maxBytes: 4 * MB };
  const clip = CLIP.exec(name);
  const id = clip && (CLIP_SOURCE_ALIASES[clip[1]] || clip[1]);
  if (clip && CLIP_FORMATS.includes(id)) {
    return { path: `clips/${id}.${clip[2]}`, maxBytes: clip[2] === "avif" ? 2 * MB : 20 * MB };
  }
  return null;
}

/**
 * Validates the release payload and keeps the assets the site uses.
 * @param {unknown} release Parsed JSON from the GitHub releases API.
 * @returns {{ name: string, url: string, size: number, path: string }[]}
 */
export function selectAssets(release) {
  const assets = release && typeof release === "object" ? /** @type {{ assets?: unknown }} */ (release).assets : null;
  if (!Array.isArray(assets)) return [];
  const out = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    const { name, size, browser_download_url: url } = asset;
    const target = assetTarget(name);
    if (!target || typeof url !== "string" || !url.startsWith("https://")) continue;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > target.maxBytes) continue;
    // DOC and DOCX share one display slot. Always prefer DOCX, independent of API ordering.
    if (!out.has(target.path) || name.startsWith("clips-docx.")) {
      out.set(target.path, { name, url, size, path: target.path });
    }
  }
  return [...out.values()];
}

function headers(accept) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return {
    Accept: accept,
    "User-Agent": "swarmloom-site-build",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function sizeOf(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return -1;
  }
}

async function download(asset, outDir) {
  const dest = join(outDir, asset.path);
  if ((await sizeOf(dest)) === asset.size) return "cached";
  await mkdir(dirname(dest), { recursive: true });
  const response = await fetch(asset.url, {
    headers: headers("application/octet-stream"),
    redirect: "follow",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp));
    const got = await sizeOf(tmp);
    if (got !== asset.size) throw new Error(`size mismatch (${got} of ${asset.size} bytes)`);
    await rename(tmp, dest);
  } finally {
    await rm(tmp, { force: true });
  }
  return "downloaded";
}

/**
 * Reads the release metadata. Never throws: a failed lookup comes back as `error`.
 * @returns {Promise<{ release?: unknown, error?: string, missing?: boolean }>}
 */
async function lookupRelease() {
  const api = `https://api.github.com/repos/${REPO_SLUG}/releases/tags/${MEDIA_TAG}`;
  let response;
  try {
    response = await fetch(api, {
      headers: headers("application/vnd.github+json"),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return { release: await response.json() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  return { error: `HTTP ${response.status}`, missing: response.status === 404 };
}

/**
 * Fetches the release and downloads every usable asset. By default failures are logged and the
 * site keeps its SVG scenes. With `required` a failed lookup, a release without usable media or
 * any failed download throws, so a deploy never ships with media silently missing.
 * @param {string} outDir Absolute path of public/media.
 * @param {{ required?: boolean }} [options]
 * @returns {Promise<number>} Number of files present after the run.
 */
export async function fetchMedia(outDir, { required = false } = {}) {
  const lookup = await lookupRelease();
  if (lookup.error) {
    if (required) throw new Error(`release "${MEDIA_TAG}" lookup failed (${lookup.error})`);
    if (lookup.missing) console.log(`[fetch-media] no "${MEDIA_TAG}" release yet; the site uses its SVG scenes.`);
    else console.warn(`[fetch-media] release lookup failed (${lookup.error}); continuing without media.`);
    return 0;
  }
  const assets = selectAssets(lookup.release);
  if (required && assets.length === 0) throw new Error(`release "${MEDIA_TAG}" lists no usable media`);
  const failed = [];
  for (const asset of assets) {
    try {
      const result = await download(asset, outDir);
      console.log(`[fetch-media] ${result} ${asset.path} (${(asset.size / MB).toFixed(1)} MB)`);
    } catch (error) {
      failed.push(asset.name);
      console.warn(`[fetch-media] skipped ${asset.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  const present = assets.length - failed.length;
  console.log(`[fetch-media] ${present} of ${assets.length} media files ready.`);
  if (required && failed.length > 0) throw new Error(`could not download ${failed.join(", ")}`);
  return present;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  if (process.env.SWARMLOOM_SKIP_MEDIA === "1") {
    console.log("[fetch-media] skipped (SWARMLOOM_SKIP_MEDIA=1).");
  } else {
    const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public/media");
    try {
      await fetchMedia(outDir, { required: process.env.SWARMLOOM_REQUIRE_MEDIA === "1" });
    } catch (error) {
      console.error(`[fetch-media] ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
}
