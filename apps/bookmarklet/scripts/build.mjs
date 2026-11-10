#!/usr/bin/env node
// Builds the bookmarklet into dist/ (published by the Pages workflow at /swarmloom/bm/):
//   swarm.js         hosted bundle (snapshot-dom + core), ES module
//   index.html       install page with the bookmarklet baked in, plus install.js and style.css
//   bookmarklet.txt  the default javascript: URL (for docs and the site)
//
// Usage: node scripts/build.mjs [--base <url>] [--studio <url>]
//   --base    Pages base URL; the bundle is served from <base>bm/swarm.js.
//             Default $SWARMLOOM_PAGES_BASE or https://boulea7.github.io/swarmloom/
//   --studio  Studio URL, absolute or relative to the bundle. Default ../studio/?from=bookmarklet
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { resolveBuildConfig } from "./config.mjs";
import { buildLoaderCode } from "./loader.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
const brand = join(root, "..", "..", "assets", "brand");

// The URL helpers are TypeScript shared with the install page; esbuild compiles them for Node.
async function loadUrlHelpers() {
  const result = await build({
    entryPoints: [join(root, "src/bookmarklet-url.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "warning",
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

/** Escapes text for an HTML attribute value or element content. */
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

const { values } = parseArgs({
  options: { base: { type: "string" }, studio: { type: "string" } },
});
const config = resolveBuildConfig({
  base: values.base ?? process.env.SWARMLOOM_PAGES_BASE,
  studio: values.studio,
});
const { MAX_BOOKMARKLET_LENGTH, OPTIONS_PLACEHOLDER, fillLoaderTemplate, toBookmarkletUrl } = await loadUrlHelpers();

const template = await buildLoaderCode({
  bundleUrl: config.bundleUrl,
  studioUrl: config.studioUrl,
  options: OPTIONS_PLACEHOLDER,
});
const bookmarklet = toBookmarkletUrl(fillLoaderTemplate(template, ""));
if (bookmarklet.length > MAX_BOOKMARKLET_LENGTH) {
  throw new Error(
    `bookmarklet is ${bookmarklet.length} characters, over the ${MAX_BOOKMARKLET_LENGTH} limit; shorten --base or src/loader.ts`,
  );
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = {
  bundle: true,
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  // Workspace packages resolve to src/, so the build never needs their dist/ output.
  conditions: ["@swarmloom/source"],
};

await build({
  ...common,
  entryPoints: [join(root, "src/swarm.ts")],
  outfile: join(out, "swarm.js"),
  format: "esm",
  target: ["chrome111", "firefox115", "safari16.4"],
  sourcemap: "linked",
  define: { __SWARMLOOM_STUDIO_URL__: JSON.stringify(config.studioUrl) },
});

await build({
  ...common,
  entryPoints: [join(root, "src/install/main.ts")],
  outfile: join(out, "install.js"),
  format: "iife",
  target: ["chrome100", "firefox100", "safari15"],
  define: { __SWARMLOOM_LOADER_TEMPLATE__: JSON.stringify(template) },
});

const page = readFileSync(join(root, "public/index.html"), "utf8");
const placeholders = {
  __SWARMLOOM_BOOKMARKLET__: escapeHtml(bookmarklet),
  __SWARMLOOM_STUDIO_HREF__: escapeHtml(config.studioHref),
  __SWARMLOOM_BOOKMARKLET_KB__: (bookmarklet.length / 1024).toFixed(1),
};
let html = page;
for (const [token, value] of Object.entries(placeholders)) {
  if (!html.includes(token)) throw new Error(`public/index.html lacks ${token}`);
  html = html.replaceAll(token, value);
}
// Brand assets are owned by the brand zone; copy the favicon when it exists, else drop its link.
const favicon = join(brand, "favicon.svg");
if (existsSync(favicon)) {
  copyFileSync(favicon, join(out, "favicon.svg"));
} else {
  console.warn("assets/brand/favicon.svg not found; the install page ships without a favicon");
  html = html.replace(/^\s*<link rel="icon"[^>]*>\n/m, "");
}

writeFileSync(join(out, "index.html"), html);
copyFileSync(join(root, "public/style.css"), join(out, "style.css"));
writeFileSync(join(out, "bookmarklet.txt"), `${bookmarklet}\n`);

console.log(`built dist/: bookmarklet ${bookmarklet.length} characters, bundle ${config.bundleUrl}`);
