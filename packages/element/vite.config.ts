import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

/**
 * CDN builds of `<swarm-loom>` (the npm ESM build is produced by tsup):
 *
 *   vite build --mode adapters  -> dist/swarm-loom.adapters.js + dist/chunks/* + dist/assets/*
 *                                  (ESM, one chunk per adapter)
 *   vite build --mode global    -> dist/swarm-loom.global.js  (IIFE: element + engine)
 *
 * The global build swaps the formats registry for src/cdn/registry.ts, which imports
 * swarm-loom.adapters.js relative to the script URL, so no adapter code is inlined into the IIFE.
 *
 * The adapters build is an app build with one entry, not a library build: library mode inlines every
 * `new URL(asset, import.meta.url)` as a base64 data URL, which put both pdf.js workers into the PDF
 * adapter chunk and both Draco decoders into the DRACOLoader chunk. An app build emits them to
 * dist/assets/ and resolves them relative to the chunk, so a page only fetches the file it uses.
 */

const cdnRegistry = fileURLToPath(new URL("./src/cdn/registry.ts", import.meta.url));

function swapRegistry(): Plugin {
  return {
    name: "swarmloom:cdn-registry",
    enforce: "pre",
    resolveId(source, importer) {
      const fromFormats = importer?.replaceAll("\\", "/").includes("/packages/formats/src/");
      return fromFormats && source === "./registry" ? cdnRegistry : null;
    },
  };
}

/**
 * App builds wrap every dynamic import in Vite's preload helper, which dispatches `vite:preloadError`
 * on the host page's window when a chunk fails to load (host apps often reload the page on it, or
 * cancel it and get `undefined` as the module). These chunks preload nothing, so a plain call suffices.
 */
function plainDynamicImports(): Plugin {
  const helperId = "\0vite/preload-helper.js";
  return {
    name: "swarmloom:plain-dynamic-imports",
    enforce: "pre",
    load(id) {
      return id === helperId ? "export const __vitePreload = (load) => load();" : null;
    },
  };
}

/** Names adapter chunks after their workspace package: chunks/adapter-pdf-[hash].js. */
function chunkName(chunk: { name: string; facadeModuleId: string | null }): string {
  const pkg = chunk.facadeModuleId?.replaceAll("\\", "/").match(/\/packages\/([\w-]+)\/src\//)?.[1];
  return `chunks/${pkg ?? chunk.name}-[hash].js`;
}

export default defineConfig(({ mode }) => {
  const global = mode === "global";
  if (!global && mode !== "adapters") throw new Error(`Unknown build mode "${mode}": use --mode global or adapters`);
  const resolve = { conditions: ["@swarmloom/source", ...defaultClientConditions] };
  const build = { target: "es2022", emptyOutDir: false, sourcemap: true } as const;
  if (global) {
    return {
      resolve,
      plugins: [swapRegistry()],
      build: {
        ...build,
        lib: {
          entry: "src/cdn/global.ts",
          name: "SwarmLoom",
          formats: ["iife"],
          fileName: () => "swarm-loom.global.js",
        },
      },
    };
  }
  return {
    // Relative base: chunks and assets resolve against import.meta.url wherever dist/ is hosted.
    base: "./",
    resolve,
    plugins: [plainDynamicImports()],
    build: {
      ...build,
      modulePreload: false,
      rolldownOptions: {
        input: { "swarm-loom.adapters": "src/cdn/adapters.ts" },
        // App builds drop entry exports by default; registry.ts calls loadAdapter() on this module.
        // "allow-extension" lets shared code (the helper above) stay in the entry, not in an extra chunk.
        preserveEntrySignatures: "allow-extension",
        output: { format: "es", entryFileNames: "swarm-loom.adapters.js", chunkFileNames: chunkName },
      },
    },
  };
});
