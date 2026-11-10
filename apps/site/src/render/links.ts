/** Resolves every outgoing link of a page from config.ts and the render context. */

import { LOCALE_PATH, RELEASES_URL, REPO_URL, SAFARI_GUIDE_ANCHOR, SIBLING_PATHS, sitePath } from "../config";
import type { InstallAction, Locale } from "../content/types";

/** Every outgoing link of one locale. */
export interface Links {
  home: string;
  otherHome: string;
  studio: string;
  docs: string;
  installGuide: string;
  safariGuide: string;
  releases: string;
  repo: string;
  license: string;
  example(id: string): string;
  action(target: InstallAction["target"]): string;
}

/** Builds the link table for one locale. */
export function linksFor(locale: Locale, base: string): Links {
  const other: Locale = locale === "zh" ? "en" : "zh";
  const studio = sitePath(base, SIBLING_PATHS.studio);
  const installGuide = sitePath(base, SIBLING_PATHS.installGuide[locale]);
  const links: Links = {
    home: sitePath(base, LOCALE_PATH[locale]),
    otherHome: sitePath(base, LOCALE_PATH[other]),
    studio,
    docs: sitePath(base, SIBLING_PATHS.docs[locale]),
    installGuide,
    safariGuide: `${installGuide}#${encodeURIComponent(SAFARI_GUIDE_ANCHOR[locale])}`,
    releases: RELEASES_URL,
    repo: REPO_URL,
    license: `${REPO_URL}/blob/main/LICENSE`,
    example: (id) => `${studio}?example=${encodeURIComponent(id)}`,
    action: (target) => {
      switch (target) {
        case "releases":
          return links.releases;
        case "guide":
          return links.installGuide;
        case "safari-guide":
          return links.safariGuide;
        case "studio":
          return links.studio;
      }
    },
  };
  return links;
}

/** True for links that leave the site (opened without referrer leakage). */
export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}
