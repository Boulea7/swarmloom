#!/usr/bin/env node
// Fails when pnpm-lock.yaml references any host other than the public npm registry.
// The lockfile is published, so private mirrors or tarball URLs must never end up in it.
import { readFileSync } from "node:fs";

const ALLOWED_HOSTS = new Set(["registry.npmjs.org"]);
const lock = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
const problems = [];

lock.split("\n").forEach((line, i) => {
  // Deprecation notices are free text copied from the registry and may cite any website.
  if (/^\s*deprecated:/.test(line)) return;
  for (const [url] of line.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s'"),}]+/gi)) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      // Unparseable URL: report it below.
    }
    if (!ALLOWED_HOSTS.has(host)) problems.push(`line ${i + 1}: ${url}`);
  }
  if (/^\s*registry:/.test(line)) problems.push(`line ${i + 1}: custom registry entry`);
});

if (problems.length) {
  console.error(`pnpm-lock.yaml references hosts outside the public npm registry:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("pnpm-lock.yaml: public npm registry only");
