import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig } from "vite";
import { repoRoot, sitePlugin } from "./build/plugin";
import { DEFAULT_SITE_URL } from "./src/config";

const root = dirname(fileURLToPath(import.meta.url));

// GitHub Pages serves the site under /swarmloom/; local dev and previews use "/".
const base = process.env.SWARMLOOM_SITE_BASE || "/";
const siteUrl = process.env.SWARMLOOM_SITE_URL || DEFAULT_SITE_URL;

export default defineConfig({
  root,
  base,
  resolve: {
    // Workspace packages resolve to src/ so the site never needs prebuilt dist/ folders.
    conditions: ["@swarmloom/source", ...defaultClientConditions],
  },
  plugins: [
    sitePlugin({ root, siteUrl, brandDir: process.env.SWARMLOOM_BRAND_DIR || join(repoRoot(root), "assets/brand") }),
  ],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        en: resolve(root, "en/index.html"),
        notFound: resolve(root, "404.html"),
      },
    },
  },
});
