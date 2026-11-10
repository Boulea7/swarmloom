#!/usr/bin/env node
/**
 * Downloads the site's videos, posters and captions from the GitHub release `media-v1` into
 * `public/media/`, so large media never lives in git. Runs before every `vite build`.
 *
 * Release asset names are flat; they map to files under public/media/ like this:
 *   promo-zh.mp4, promo-en.mp4, promo-poster.avif, promo-zh.vtt, promo-en.vtt  -> same name
 *   clip-<format>.mp4 | clip-<format>.webm | clip-<format>.avif               -> clips/<format>.<ext>
 *
 * Unknown names are ignored. A missing release (404), a network failure or a rate limit is not an
 * error: the site falls back to its animated SVG scenes. Set SWARMLOOM_SKIP_MEDIA=1 to skip, and
 * GITHUB_TOKEN (or GH_TOKEN) to raise the API rate limit in CI.
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

const MB = 1024 * 1024;
const PROMO = /^promo-(zh|en)\.mp4$/;
const CAPTIONS = /^promo-(zh|en)\.vtt$/;
const CLIP = /^clip-([a-z]+)\.(mp4|webm|avif)$/;

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
  if (clip && CLIP_FORMATS.includes(clip[1])) {
    return { path: `clips/${clip[1]}.${clip[2]}`, maxBytes: clip[2] === "avif" ? 2 * MB : 20 * MB };
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
  const out = [];
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    const { name, size, browser_download_url: url } = asset;
    const target = assetTarget(name);
    if (!target || typeof url !== "string" || !url.startsWith("https://")) continue;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > target.maxBytes) continue;
    out.push({ name, url, size, path: target.path });
  }
  return out;
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
 * Fetches the release and downloads every usable asset. Never throws: failures are logged.
 * @param {string} outDir Absolute path of public/media.
 * @returns {Promise<number>} Number of files present after the run.
 */
export async function fetchMedia(outDir) {
  const api = `https://api.github.com/repos/${REPO_SLUG}/releases/tags/${MEDIA_TAG}`;
  let release;
  try {
    const response = await fetch(api, {
      headers: headers("application/vnd.github+json"),
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 404) {
      console.log(`[fetch-media] no "${MEDIA_TAG}" release yet; the site uses its SVG scenes.`);
      return 0;
    }
    if (!response.ok) {
      console.warn(`[fetch-media] release lookup failed (HTTP ${response.status}); continuing without media.`);
      return 0;
    }
    release = await response.json();
  } catch (error) {
    console.warn(
      `[fetch-media] release lookup failed (${error instanceof Error ? error.message : error}); continuing.`,
    );
    return 0;
  }
  const assets = selectAssets(release);
  let present = 0;
  for (const asset of assets) {
    try {
      const result = await download(asset, outDir);
      present++;
      console.log(`[fetch-media] ${result} ${asset.path} (${(asset.size / MB).toFixed(1)} MB)`);
    } catch (error) {
      console.warn(`[fetch-media] skipped ${asset.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`[fetch-media] ${present} of ${assets.length} media files ready.`);
  return present;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  if (process.env.SWARMLOOM_SKIP_MEDIA === "1") {
    console.log("[fetch-media] skipped (SWARMLOOM_SKIP_MEDIA=1).");
  } else {
    const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public/media");
    await fetchMedia(outDir);
  }
}
