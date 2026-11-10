/**
 * Site-wide constants. Everything that may change without a design change lives here:
 * the contact address, repository links and the relative paths of sibling apps on Pages.
 */

import type { Locale } from "./content/types";

/** Public contact address shown at the end of the page. Change it here only. */
export const CONTACT_EMAIL = "pvt.blocksongs@gmail.com";

/** Canonical GitHub repository. */
export const REPO_URL = "https://github.com/Boulea7/swarmloom";

/** Releases page; extension packages are downloaded from here until the store listings exist. */
export const RELEASES_URL = `${REPO_URL}/releases`;

/** Production origin + base path of the site. Overridable at build time with SWARMLOOM_SITE_URL. */
export const DEFAULT_SITE_URL = "https://boulea7.github.io/swarmloom/";

/** Release tag whose assets hold the videos, posters and captions (fetched at build time). */
export const MEDIA_RELEASE_TAG = "media-v1";

/** Repository slug used by scripts/fetch-media.mjs. Keep in sync with REPO_URL. */
export const REPO_SLUG = "Boulea7/swarmloom";

/** Path of each locale's home page relative to the site base. */
export const LOCALE_PATH: Record<Locale, string> = { zh: "", en: "en/" };

/** BCP 47 tags for `lang` and `hreflang`. */
export const LOCALE_TAG: Record<Locale, string> = { zh: "zh-CN", en: "en" };

/**
 * Paths of sibling apps relative to the site base. The Pages workflow assembles
 * the site at `/`, Studio at `/studio/` and the docs at `/docs/` (VitePress, clean URLs).
 */
export const SIBLING_PATHS = {
  studio: "studio/",
  docs: { zh: "docs/", en: "docs/en/" },
  installGuide: { zh: "docs/install", en: "docs/en/install" },
} as const;

/** Heading ids of the Safari section in the install guide (VitePress slugs of the headings). */
export const SAFARI_GUIDE_ANCHOR: Record<Locale, string> = {
  zh: "safari-从源码构建",
  en: "safari-build-from-source",
};

/** Resolves a site-relative path against the base path ("/" in dev, "/swarmloom/" on Pages). */
export function sitePath(base: string, path = ""): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}${path.replace(/^\/+/, "")}`;
}

/** Absolute URL of a site-relative path, for canonical links, hreflang, OG and the sitemap. */
export function absoluteUrl(siteUrl: string, path = ""): string {
  return new URL(path.replace(/^\/+/, ""), siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`).href;
}
