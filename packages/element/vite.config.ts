import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

/**
 * CDN builds of `<swarm-loom>` (the npm ESM build is produced by tsup):
 *
 *   vite build --mode adapters  -> dist/swarm-loom.adapters.js + dist/chunks/*  (ESM, one chunk per adapter)
 *   vite build --mode global    -> dist/swarm-loom.global.js                    (IIFE: element + engine)
 *
 * The global build swaps the formats registry for src/cdn/registry.ts, which imports
 * swarm-loom.adapters.js relative to the script URL, so no adapter code is inlined into the IIFE.
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

/** Names adapter chunks after their workspace package: chunks/adapter-pdf-[hash].js. */
function chunkName(chunk: { name: string; facadeModuleId: string | null }): string {
  const pkg = chunk.facadeModuleId?.replaceAll("\\", "/").match(/\/packages\/([\w-]+)\/src\//)?.[1];
  return `chunks/${pkg ?? chunk.name}-[hash].js`;
}

export default defineConfig(({ mode }) => {
  const global = mode === "global";
  if (!global && mode !== "adapters") throw new Error(`Unknown build mode "${mode}": use --mode global or adapters`);
  return {
    resolve: { conditions: ["@swarmloom/source", ...defaultClientConditions] },
    plugins: global ? [swapRegistry()] : [],
    build: {
      target: "es2022",
      emptyOutDir: false,
      sourcemap: true,
      lib: global
        ? {
            entry: "src/cdn/global.ts",
            name: "SwarmLoom",
            formats: ["iife"],
            fileName: () => "swarm-loom.global.js",
          }
        : {
            entry: "src/cdn/adapters.ts",
            formats: ["es"],
            fileName: () => "swarm-loom.adapters.js",
          },
      rolldownOptions: global ? {} : { output: { chunkFileNames: chunkName } },
    },
  };
});
