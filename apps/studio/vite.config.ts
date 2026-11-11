import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig } from "vite";
import { examplesPlugin } from "./build/examples";
import { pwaPlugin, type StudioTarget } from "./build/pwa";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
  // `STUDIO_TARGET=extension` or `--mode extension`: the page bundled in the browser extension.
  const target: StudioTarget = process.env.STUDIO_TARGET === "extension" || mode === "extension" ? "extension" : "web";
  const extension = target === "extension";
  // GitHub Pages serves Studio under /swarmloom/studio/; the extension loads it from a relative path.
  const base = extension ? "./" : process.env.SWARMLOOM_STUDIO_BASE || "/";

  return {
    base,
    define: { __STUDIO_TARGET__: JSON.stringify(target) },
    resolve: {
      // Resolve workspace packages from source so Studio never needs prebuilt dist/ folders.
      conditions: ["@swarmloom/source", ...defaultClientConditions],
    },
    plugins: [
      examplesPlugin({ dir: here("../../examples"), include: !extension }),
      pwaPlugin({ target, swEntry: here("./src/sw/sw.ts") }),
    ],
    build: {
      target: "es2022",
      outDir: extension ? "dist-extension" : "dist",
      emptyOutDir: true,
      // Adapter chunks are large by nature (pdf.js, three); they load lazily, one format at a time.
      chunkSizeWarningLimit: 1500,
    },
  };
});
