import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);
const ASSET_QUERY = /\?(raw|inline)$/;

/**
 * Vite-style asset queries for the library build: `?raw` inlines a file as a string and
 * `?inline` as a data URL. KaTeX CSS and fonts use them, so the published package works in any
 * bundler and fonts stay in lazily loaded chunks.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  noExternal: [ASSET_QUERY],
  esbuildPlugins: [
    {
      name: "asset-query",
      setup(build) {
        build.onResolve({ filter: ASSET_QUERY }, (args) => {
          const [spec = "", query = ""] = args.path.split("?");
          // Keep the query in the path so tsup's own CSS loader (filter /\.css$/) does not claim it.
          // The path is kept relative so no machine-specific directory ends up in dist comments.
          const file = relative(process.cwd(), require.resolve(spec, { paths: [args.resolveDir] }));
          return { path: `${file}?${query}`, namespace: "asset-query" };
        });
        build.onLoad({ filter: /\?raw$/, namespace: "asset-query" }, async (args) => ({
          contents: await readFile(resolve(args.path.replace(ASSET_QUERY, "")), "utf8"),
          loader: "text",
        }));
        build.onLoad({ filter: /\?inline$/, namespace: "asset-query" }, async (args) => ({
          contents: await readFile(resolve(args.path.replace(ASSET_QUERY, ""))),
          loader: "dataurl",
        }));
      },
    },
  ],
});
