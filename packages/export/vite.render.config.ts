import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import { writeStamp } from "./scripts/render-stamp.mjs";

const pkgDir = fileURLToPath(new URL(".", import.meta.url));

/**
 * Headless render page for the CLI: dist/render/index.html + render.js, adapters as lazy chunks
 * under dist/render/chunks/. Relative base so the folder can be served from any path.
 */
/** Names adapter chunks after their workspace package: chunks/adapter-pdf-[hash].js. */
function chunkName(chunk: { name: string; facadeModuleId: string | null }): string {
  const pkg = chunk.facadeModuleId?.replaceAll("\\", "/").match(/\/packages\/([\w-]+)\/src\//)?.[1];
  return `chunks/${pkg ?? chunk.name}-[hash].js`;
}

/**
 * Stamps the workspace files the page was built from (dependencies through the lockfile), so the
 * CLI build can rebuild a page that is older than the checkout instead of shipping it.
 */
function sourceStamp(): Plugin {
  const files = new Set<string>();
  return {
    name: "swarmloom-render-stamp",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        for (const id of out.moduleIds) {
          const file = id.split("?")[0] ?? "";
          if (path.isAbsolute(file) && !file.replaceAll("\\", "/").includes("/node_modules/")) files.add(file);
        }
      }
    },
    async writeBundle() {
      const fixed = ["render/index.html", "vite.render.config.ts", "package.json", "../../pnpm-lock.yaml"];
      await writeStamp(pkgDir, [...files, ...fixed.map((f) => path.join(pkgDir, f))]);
    },
  };
}

export default defineConfig({
  plugins: [sourceStamp()],
  root: fileURLToPath(new URL("./render", import.meta.url)),
  base: "./",
  publicDir: false,
  resolve: { conditions: ["@swarmloom/source", ...defaultClientConditions] },
  build: {
    target: "es2022",
    outDir: fileURLToPath(new URL("./dist/render", import.meta.url)),
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        entryFileNames: "render.js",
        chunkFileNames: chunkName,
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
