/**
 * URLs of SwarmLoom pages: the bundled (or hosted) Studio and the restricted-page notice.
 * Every value placed in a query string is validated first; nothing from a page is trusted.
 */

import { BUNDLED_STUDIO } from "./build-info";
import type { BlockReason } from "./restricted";

/** Hosted Studio, used only when the build did not bundle one (development builds). */
export const HOSTED_STUDIO = "https://boulea7.github.io/swarmloom/studio/";

/** Longest source URL handed to Studio; longer values are dropped instead of truncated. */
export const MAX_SOURCE_URL = 4096;

/** File extensions Studio can open from a link (lower case, no dot). */
export const STUDIO_EXTENSIONS: readonly string[] = [
  "pdf",
  "docx",
  "doc",
  "md",
  "markdown",
  "svg",
  "pptx",
  "xlsx",
  "csv",
  "glb",
  "gltf",
  "obj",
  "stl",
  "ply",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
];

/** Match patterns for context menus on links/images Studio can open. */
export function studioLinkPatterns(includeFiles: boolean): string[] {
  const patterns: string[] = [];
  for (const ext of STUDIO_EXTENSIONS) {
    patterns.push(`*://*/*.${ext}`, `*://*/*.${ext}?*`);
    if (includeFiles) patterns.push(`file:///*.${ext}`);
  }
  return patterns;
}

/** Returns `url` when Studio may be asked to load it (http, https or file, bounded length), else null. */
export function studioSource(url: string | undefined): string | null {
  if (!url || url.length > MAX_SOURCE_URL) return null;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "file:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export interface StudioLinkOptions {
  /** Source to load and play right away. */
  src?: string;
  /**
   * Ask Studio to highlight its file picker (`?import=1`). Combined with `src` it is the fallback
   * when the source cannot be fetched (for example a downloaded copy on Firefox Android).
   */
  importFile?: boolean;
}

/**
 * Builds a Studio URL. `getURL` is `runtime.getURL`; without a bundled Studio the hosted one is used.
 */
export function studioUrl(getURL: ((path: string) => string) | null, opts: StudioLinkOptions = {}): string {
  const base = BUNDLED_STUDIO && getURL ? getURL(BUNDLED_STUDIO) : HOSTED_STUDIO;
  const url = new URL(base);
  const src = studioSource(opts.src);
  if (src) {
    url.searchParams.set("src", src);
    url.searchParams.set("autoplay", "1");
  }
  if (opts.importFile) url.searchParams.set("import", "1");
  return url.href;
}

/** Origin match pattern (`https://example.com/*`) for an optional host permission request. */
export function originPattern(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return null;
  }
}

/** URL of the restricted-page notice. */
export function noticeUrl(getURL: (path: string) => string, reason: BlockReason, pageUrl?: string): string {
  const url = new URL(getURL("notice.html"));
  url.searchParams.set("reason", reason);
  if (pageUrl && pageUrl.length <= MAX_SOURCE_URL) url.searchParams.set("url", pageUrl);
  return url.href;
}
