#!/usr/bin/env node
// Builds unpacked extensions into dist/<browser>/ from one base manifest plus per-browser overrides.
// Usage: node scripts/build.mjs --browser all|chrome,edge,firefox,safari
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { manifestFor, parseBrowsers } from "./manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { browser: { type: "string", default: "all" } } });
const browsers = parseBrowsers(values.browser ?? "all");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

for (const browser of browsers) {
  const out = join(root, "dist", browser);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, "public"), out, { recursive: true });
  await build({
    entryPoints: [join(root, "src/background.ts")],
    outfile: join(out, "background.js"),
    bundle: true,
    format: "iife",
    target: ["chrome116", "firefox140", "safari17"],
    logLevel: "warning",
  });
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifestFor(browser, version), null, 2)}\n`);
  console.log(`built dist/${browser}`);
}
