#!/usr/bin/env node
// Builds the publishable CLI package into dist/:
//   dist/cli.js       the command (ESM, Node 20+; only playwright-core stays external)
//   dist/snapshot.js  IIFE injected into pages by `snapshot` and web page renders
//   dist/render/      the headless render page, copied from @swarmloom/export (rebuilt first when
//                     its source stamp shows it is older than this checkout)
//   dist/studio/      the Studio PWA, copied from @swarmloom/studio
// `--check` (prepublishOnly) fails when anything above is missing instead of warning.
import { cp, realpath, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

/**
 * Makes sure the render page in @swarmloom/export was built from this checkout: the adapters and the
 * engine run inside it, so a stale page renders with old code. Rebuilds it when its source stamp
 * does not match; false when that fails.
 */
async function freshRenderPage() {
  try {
    const pkgDir = await realpath(path.join(root, "node_modules/@swarmloom/export"));
    const { staleFiles } = await import(pathToFileURL(path.join(pkgDir, "scripts/render-stamp.mjs")).href);
    const stale = await staleFiles(pkgDir);
    if (stale.length === 0) return true;
    const more = stale.length > 1 ? ` and ${stale.length - 1} more` : "";
    console.log(`swarmloom build: the render page is older than ${stale[0]}${more}; rebuilding it`);
    const vite = await import(pathToFileURL(createRequire(path.join(pkgDir, "package.json")).resolve("vite")).href);
    await vite.build({ configFile: path.join(pkgDir, "vite.render.config.ts"), logLevel: "warn" });
    return true;
  } catch (error) {
    console.error(`swarmloom build: rebuilding the render page failed: ${error?.message ?? error}`);
    return false;
  }
}

const renderReady = await freshRenderPage();
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
    // Never ship a page left over from older sources.
    skip: !renderReady,
  },
  { from: path.join(root, "node_modules/@swarmloom/studio/dist"), to: "studio", what: "Studio (@swarmloom/studio)" },
];
const missing = [];
for (const { from, to, what, skip } of copies) {
  if (skip) {
    missing.push(`${what}: out of date, and rebuilding it failed`);
  } else if (await exists(path.join(from, "index.html"))) {
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
