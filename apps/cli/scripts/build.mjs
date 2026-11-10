#!/usr/bin/env node
// Builds the publishable CLI package into dist/:
//   dist/cli.js       the command (ESM, Node 20+; only playwright-core stays external)
//   dist/snapshot.js  IIFE injected into pages by `snapshot` and web page renders
//   dist/render/      the headless render page, copied from @swarmloom/export
//   dist/studio/      the Studio PWA, copied from @swarmloom/studio
// `--check` (prepublishOnly) fails when anything above is missing instead of warning.
import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const strict = process.argv.includes("--check");
// Workspace packages are bundled from source, so the CLI never depends on their build order.
const conditions = ["@swarmloom/source"];

async function exists(file) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

await rm(dist, { recursive: true, force: true });

await build({
  config: false,
  entry: { cli: path.join(root, "src/cli.ts") },
  outDir: dist,
  format: ["esm"],
  platform: "node",
  target: "node20",
  splitting: false,
  silent: true,
  // Adapters are only referenced by the lazy loaders of the format registry, never called by the CLI.
  external: ["playwright-core", "ffmpeg-static", /^@swarmloom\/adapter-/, "@swarmloom/snapshot-dom"],
  noExternal: ["@swarmloom/formats"],
  esbuildOptions(options) {
    options.conditions = conditions;
  },
});

await build({
  config: false,
  entry: { snapshot: path.join(root, "src/inject/snapshot.ts") },
  outDir: dist,
  format: ["iife"],
  platform: "browser",
  target: "es2022",
  minify: true,
  silent: true,
  noExternal: [/.*/],
  outExtension: () => ({ js: ".js" }),
  esbuildOptions(options) {
    options.conditions = conditions;
  },
});

// npm only picks up a LICENSE at the package root; ship the repository's copy inside dist/ instead.
await cp(path.join(root, "../../LICENSE"), path.join(dist, "LICENSE"));

const copies = [
  {
    from: path.join(root, "node_modules/@swarmloom/export/dist/render"),
    to: "render",
    what: "render page (@swarmloom/export)",
  },
  { from: path.join(root, "node_modules/@swarmloom/studio/dist"), to: "studio", what: "Studio (@swarmloom/studio)" },
];
const missing = [];
for (const { from, to, what } of copies) {
  if (await exists(path.join(from, "index.html"))) {
    await cp(from, path.join(dist, to), { recursive: true });
  } else {
    missing.push(`${what}: build it first (${path.relative(root, from)} has no index.html)`);
  }
}
if (missing.length) {
  const message = `swarmloom build: missing bundled assets\n  ${missing.join("\n  ")}`;
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message}\n  (the CLI still builds; commands that need them report it)`);
}
