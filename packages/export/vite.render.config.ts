import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig } from "vite";

/**
 * Headless render page for the CLI: dist/render/index.html + render.js, adapters as lazy chunks
 * under dist/render/chunks/. Relative base so the folder can be served from any path.
 */
/** Names adapter chunks after their workspace package: chunks/adapter-pdf-[hash].js. */
function chunkName(chunk: { name: string; facadeModuleId: string | null }): string {
  const pkg = chunk.facadeModuleId?.replaceAll("\\", "/").match(/\/packages\/([\w-]+)\/src\//)?.[1];
  return `chunks/${pkg ?? chunk.name}-[hash].js`;
}

export default defineConfig({
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
