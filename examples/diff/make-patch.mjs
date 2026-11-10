#!/usr/bin/env node
// Writes core-index.patch: `git format-patch` output of two small, pinned commits of this
// repository (a dependency cleanup and a public-index change), as one mailbox. E-mail addresses
// are removed from the From: headers; everything else is git's output unchanged.
//
//   node examples/diff/make-patch.mjs   (needs the full history of the repository)

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const COMMITS = [
  "d301690ded09fc718db94f2593395b4acfeb7a47", // chore(adapters): drop unused snapshot-dom dependency
  "4e065e337376fcd79f2b7cd498018493521e0832", // feat(core): export quantize, createI18n and LOCALES
];

const here = dirname(fileURLToPath(import.meta.url));
const parts = COMMITS.map((hash) =>
  execFileSync("git", ["format-patch", "--stdout", "--no-signature", "-1", hash], { cwd: here, encoding: "utf8" }),
);
const text = parts.join("").replace(/^From: (.*?) <[^>]*>$/gm, "From: $1");
writeFileSync(join(here, "core-index.patch"), text);
console.log(`core-index.patch: ${COMMITS.length} commits, ${text.split("\n").length} lines`);
