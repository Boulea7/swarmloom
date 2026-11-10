/**
 * Vite plugin that turns the build-time renderer into pages: it replaces the placeholder HTML
 * entries with the rendered documents, inlines the early bootstrap script, copies the display font
 * and the brand assets, and emits sitemap.xml and robots.txt. Node-only.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { buildSync } from "esbuild";
import type { Plugin, ResolvedConfig } from "vite";
import { absoluteUrl, LOCALE_PATH, LOCALE_TAG } from "../src/config";
import { en } from "../src/content/en";
import type { Locale, SiteCopy } from "../src/content/types";
import { zh } from "../src/content/zh";
import { faviconSvg } from "../src/render/art/logo";
import type { RenderContext } from "../src/render/context";
import { DISPLAY_FONT_FILE } from "../src/render/head";
import { renderHome, renderNotFound } from "../src/render/page";
import { scanBrand, scanMedia } from "./manifest";

const COPY: Record<Locale, SiteCopy> = { zh, en };
const PAGE_MARKER = /<!--\s*swarmloom:page\s+(zh|en|404)\s*-->/;
const FONT_MARKER = /<meta name="swarmloom-font-face" content="([^"]*)">/;

const unescapeAttr = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Brand files copied into `brand/` when the brand zone has produced them. */
const BRAND_FILES = ["favicon.svg", "og-zh.png", "og-en.png", "icon-192.png", "logo.svg", "logo-dark.svg"] as const;

export interface SitePluginOptions {
  /** apps/site directory. */
  root: string;
  /** Absolute production URL of the base (canonical, hreflang, OG, sitemap). */
  siteUrl: string;
  /** Repository-level brand directory (assets/brand). */
  brandDir: string;
}

function fontSource(root: string): string {
  const require = createRequire(join(root, "package.json"));
  const pkg = dirname(require.resolve("@fontsource-variable/bricolage-grotesque/package.json"));
  return join(pkg, "files", DISPLAY_FONT_FILE.replace(/^fonts\//, ""));
}

function earlyScript(root: string): string {
  const out = buildSync({
    entryPoints: [join(root, "src/client/early.ts")],
    bundle: true,
    write: false,
    minify: true,
    format: "iife",
    target: "es2019",
    legalComments: "none",
  });
  const code = out.outputFiles[0]?.text.trim() ?? "";
  // Inline scripts must not contain a closing tag sequence.
  return code.replace(/<\/script/gi, "<\\/script");
}

function sitemap(siteUrl: string): string {
  const alternates = (Object.keys(LOCALE_PATH) as Locale[])
    .map(
      (l) => `<xhtml:link rel="alternate" hreflang="${LOCALE_TAG[l]}" href="${absoluteUrl(siteUrl, LOCALE_PATH[l])}"/>`,
    )
    .join("");
  const def = `<xhtml:link rel="alternate" hreflang="x-default" href="${absoluteUrl(siteUrl, LOCALE_PATH.zh)}"/>`;
  const urls = (Object.keys(LOCALE_PATH) as Locale[])
    .map((l) => `<url><loc>${absoluteUrl(siteUrl, LOCALE_PATH[l])}</loc>${alternates}${def}</url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>\n`;
}

function robots(siteUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl(siteUrl, "sitemap.xml")}\n`;
}

/** Replaces the font-face marker left by the renderer with an inline style element. */
export function inlineFontFaces(html: string): string {
  return html.replace(FONT_MARKER, (_, css: string) => `<style>${unescapeAttr(css)}</style>`);
}

/** The site plugins: page rendering plus a late pass that inlines the font faces. */
export function sitePlugin(options: SitePluginOptions): Plugin[] {
  return [
    pagesPlugin(options),
    { name: "swarmloom-site:fonts", transformIndexHtml: { order: "post", handler: inlineFontFaces } },
  ];
}

function pagesPlugin(options: SitePluginOptions): Plugin {
  const { root, siteUrl, brandDir } = options;
  let config: ResolvedConfig;
  let early = "";

  const context = (): RenderContext => ({
    base: config.base,
    siteUrl,
    media: scanMedia(join(root, "public/media")),
    brand: scanBrand(brandDir),
    fonts: [DISPLAY_FONT_FILE],
    earlyScript: early || earlyScript(root),
    entry: "/src/client/main.ts",
    stylesheet: "/src/styles/main.css",
  });

  return {
    name: "swarmloom-site",
    configResolved(resolved) {
      config = resolved;
    },
    buildStart() {
      early = config.command === "build" ? earlyScript(root) : "";
      for (const file of ["src/client/early.ts", "src/client/detect.ts"]) this.addWatchFile(join(root, file));
      const ctx = context();
      if (config.command === "build" && !ctx.brand.og.zh) {
        this.warn(`brand assets not found in ${brandDir}; using the inline favicon and no OG image`);
      }
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const which = PAGE_MARKER.exec(html)?.[1];
        if (!which) return html;
        const ctx = context();
        if (which === "404") return renderNotFound(zh, en, ctx);
        return renderHome(COPY[which as Locale], ctx);
      },
    },
    configureServer(server) {
      // Dev: serve the font and brand files from their packages, like the build does.
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        const path = url.startsWith(config.base) ? url.slice(config.base.length) : null;
        let file: string | null = null;
        if (path === DISPLAY_FONT_FILE) file = fontSource(root);
        const brand = path?.startsWith("brand/") ? path.slice(6) : null;
        if (brand && (BRAND_FILES as readonly string[]).includes(brand)) file = join(brandDir, brand);
        if (brand === "favicon.svg" && file && !existsSync(file)) {
          res.setHeader("Content-Type", "image/svg+xml");
          res.end(faviconSvg());
          return;
        }
        if (!file || !existsSync(file)) return next();
        const type = file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".svg") ? "image/svg+xml" : "image/png";
        res.setHeader("Content-Type", type);
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: DISPLAY_FONT_FILE, source: readFileSync(fontSource(root)) });
      for (const name of BRAND_FILES) {
        const file = join(brandDir, name);
        if (existsSync(file)) this.emitFile({ type: "asset", fileName: `brand/${name}`, source: readFileSync(file) });
      }
      if (!existsSync(join(brandDir, "favicon.svg"))) {
        this.emitFile({ type: "asset", fileName: "brand/favicon.svg", source: faviconSvg() });
      }
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemap(siteUrl) });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robots(siteUrl) });
    },
  };
}

/** Repository root from apps/site. */
export function repoRoot(root: string): string {
  return resolve(root, "../..");
}
