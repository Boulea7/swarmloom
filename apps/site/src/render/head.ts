/** Document head: SEO, social cards, hreflang, fonts and the early bootstrap script. */

import { absoluteUrl, LOCALE_PATH, LOCALE_TAG, REPO_URL, sitePath } from "../config";
import type { Locale, SiteCopy } from "../content/types";
import type { RenderContext } from "./context";
import { esc } from "./html";

/**
 * The one self-hosted face: Bricolage Grotesque (OFL-1.1, latin subset, weight axis, ~41 KB), the
 * typeface of the SwarmLoom logotype. Body text uses the system UI stack. Copied from
 * @fontsource-variable by the Vite plugin, together with its licence as fonts/OFL.txt.
 */
export const DISPLAY_FONT_FILE = "fonts/bricolage-grotesque-latin-wght-normal.woff2";

const OG_LOCALE: Record<Locale, string> = { zh: "zh_CN", en: "en_US" };

/**
 * `font-display: swap` with a preload: the file is small enough to arrive with the CSS on a fast
 * connection. Headline lines are explicit blocks with a fixed line height, so a late swap only
 * changes glyph shapes, never the layout below.
 */
function fontFaces(base: string): string {
  return (
    `@font-face{font-family:"Bricolage Grotesque";src:url("${sitePath(base, DISPLAY_FONT_FILE)}") format("woff2");` +
    "font-weight:200 800;font-style:normal;font-display:swap;" +
    "unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}"
  );
}

function jsonLd(copy: SiteCopy, url: string): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SwarmLoom",
    alternateName: "群织",
    description: copy.meta.description,
    url,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web, Chrome, Edge, Brave, Opera, Firefox, Safari, macOS, Windows, Linux, Android, iOS",
    license: "https://opensource.org/licenses/MIT",
    codeRepository: REPO_URL,
    inLanguage: LOCALE_TAG[copy.locale],
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  // "<" is escaped so the JSON can never close the script element early.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export interface HeadOptions {
  copy: SiteCopy;
  ctx: RenderContext;
  /** Page title override (404). */
  title?: string;
  /** Index the page and emit canonical/hreflang. False for 404. */
  indexable: boolean;
}

/** Renders everything inside <head>. */
export function renderHead({ copy, ctx, title, indexable }: HeadOptions): string {
  const { base, siteUrl, brand } = ctx;
  const url = absoluteUrl(siteUrl, LOCALE_PATH[copy.locale]);
  const pageTitle = title ?? copy.meta.title;
  const other: Locale = copy.locale === "zh" ? "en" : "zh";
  const ogImage = brand.og[copy.locale] ? absoluteUrl(siteUrl, `brand/og-${copy.locale}.png`) : null;
  // Always present: the plugin falls back to the inline mark when the brand file is missing.
  const favicon = sitePath(base, "brand/favicon.svg");
  const lines: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(pageTitle)}</title>`,
    `<meta name="description" content="${esc(copy.meta.description)}">`,
    '<meta name="color-scheme" content="light dark">',
    '<meta name="theme-color" content="#FAFAFC" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#0B0B12" media="(prefers-color-scheme: dark)">',
    `<script>${ctx.earlyScript}</script>`,
    ...ctx.fonts.map(
      (file) => `<link rel="preload" href="${sitePath(base, file)}" as="font" type="font/woff2" crossorigin>`,
    ),
    // The plugin swaps this marker for the @font-face rules after Vite's HTML pass (the font is
    // emitted by the plugin, not a module Vite could resolve).
    `<meta name="swarmloom-font-face" content="${esc(fontFaces(base))}">`,
    `<link rel="stylesheet" href="${ctx.stylesheet}">`,
    `<link rel="icon" href="${favicon}" type="image/svg+xml">`,
  ];
  if (brand.appleTouchIcon) {
    lines.push(`<link rel="apple-touch-icon" href="${sitePath(base, "brand/icon-192.png")}">`);
  }
  if (indexable) {
    lines.push(
      `<link rel="canonical" href="${url}">`,
      `<link rel="alternate" hreflang="zh-CN" href="${absoluteUrl(siteUrl, LOCALE_PATH.zh)}">`,
      `<link rel="alternate" hreflang="en" href="${absoluteUrl(siteUrl, LOCALE_PATH.en)}">`,
      `<link rel="alternate" hreflang="x-default" href="${absoluteUrl(siteUrl, LOCALE_PATH.zh)}">`,
      '<meta property="og:type" content="website">',
      `<meta property="og:site_name" content="${esc(copy.meta.siteName)}">`,
      `<meta property="og:title" content="${esc(pageTitle)}">`,
      `<meta property="og:description" content="${esc(copy.meta.description)}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta property="og:locale" content="${OG_LOCALE[copy.locale]}">`,
      `<meta property="og:locale:alternate" content="${OG_LOCALE[other]}">`,
    );
    if (ogImage) {
      lines.push(
        `<meta property="og:image" content="${ogImage}">`,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        `<meta property="og:image:alt" content="${esc(copy.meta.ogImageAlt)}">`,
      );
    }
    lines.push(
      `<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">`,
      `<meta name="twitter:title" content="${esc(pageTitle)}">`,
      `<meta name="twitter:description" content="${esc(copy.meta.description)}">`,
    );
    if (ogImage) {
      lines.push(
        `<meta name="twitter:image" content="${ogImage}">`,
        `<meta name="twitter:image:alt" content="${esc(copy.meta.ogImageAlt)}">`,
      );
    }
    lines.push(`<script type="application/ld+json">${jsonLd(copy, url)}</script>`);
  } else {
    lines.push('<meta name="robots" content="noindex">');
  }
  lines.push(`<script type="module" src="${ctx.entry}"></script>`);
  return lines.join("\n    ");
}
