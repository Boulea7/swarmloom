#!/usr/bin/env node
// Audits built store packages: manifest and permission allowlist, CSP, no remote code, no test hook,
// content script size budget, licence notices present, and that each zip is exactly (and
// reproducibly) its folder.
//
// Usage: node scripts/audit.mjs [--target all|chrome,edge,firefox,safari] [--dist <dir>]
// Exits 1 and lists every problem when a package fails. Runs on existing output; build first.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { validateManifest } from "./manifest.mjs";
import { LICENSE_COPY, NOTICES_FILE } from "./notices.mjs";
import { parseTargets } from "./targets.mjs";
import { directoryEntries, unzipEntries, zipEntries } from "./zip.mjs";

/** Content script budget (research/product-spec.md: content script <= 150 KB gzip). */
export const CONTENT_SCRIPT_BUDGET = 150 * 1024;

/**
 * Patterns that load or evaluate code from outside the package. `ownCodeOnly` rules skip the bundled
 * Studio (`studio/`): third-party code there may probe for eval support, which the extension CSP
 * blocks anyway; loading remote code is checked everywhere.
 */
const REMOTE_CODE = [
  { name: "remote <script src>", re: /<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i, ext: ".html" },
  {
    name: "remote stylesheet",
    re: /<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\/[^>]*>/i,
    ext: ".html",
    stylesheetOnly: true,
  },
  { name: "remote import", re: /\b(?:import\s*\(|from)\s*["'`](?:https?:)?\/\//, ext: ".js" },
  { name: "importScripts from a URL", re: /\bimportScripts\s*\(\s*["'`](?:https?:)?\/\//, ext: ".js" },
  { name: "eval", re: /(?<![.\w$])eval\s*\(/, ext: ".js", ownCodeOnly: true },
  { name: "new Function", re: /\bnew\s+Function\s*\(/, ext: ".js", ownCodeOnly: true },
];

/** Name of the e2e hook; it must never reach a store package. */
const TEST_HOOK = "__swarmloomTest";

/** @param {Buffer | Uint8Array} data */
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * Audits one unpacked package folder (and its zip, when given).
 * @param {string} dir Package folder (dist/<target>).
 * @param {import("./targets.mjs").TargetId} target
 * @param {string} [zipPath] The store zip built from `dir`.
 * @returns {string[]} problems, empty when the package passes
 */
export function auditPackage(dir, target, zipPath) {
  /** @type {string[]} */
  const problems = [];
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return [`${target}: no manifest.json in ${dir}`];
  /** @type {Record<string, unknown>} */
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return [`${target}: manifest.json is not JSON (${/** @type {Error} */ (error).message})`];
  }
  problems.push(...validateManifest(manifest, target));

  const files = directoryEntries(dir);
  for (const { name, data } of files) {
    if (!name.endsWith(".js") && !name.endsWith(".html")) continue;
    const text = Buffer.from(data).toString("utf8");
    for (const rule of REMOTE_CODE) {
      if (!name.endsWith(rule.ext) || (rule.ownCodeOnly && name.startsWith("studio/"))) continue;
      const match = text.match(rule.re);
      if (match && (!rule.stylesheetOnly || /stylesheet|modulepreload|preload/i.test(match[0]))) {
        problems.push(`${name}: ${rule.name}`);
      }
    }
    if (text.includes(TEST_HOOK)) problems.push(`${name}: contains the e2e test hook`);
  }

  for (const name of [NOTICES_FILE, LICENSE_COPY]) {
    if (!files.some((f) => f.name === name && f.data.length > 0)) problems.push(`${name} is missing or empty`);
  }

  const content = files.find((f) => f.name === "swarm.js");
  if (!content) problems.push("swarm.js is missing");
  else {
    const size = gzipSync(content.data, { level: 9 }).length;
    if (size > CONTENT_SCRIPT_BUDGET) {
      problems.push(
        `swarm.js is ${(size / 1024).toFixed(1)} KB gzip, over the ${CONTENT_SCRIPT_BUDGET / 1024} KB budget`,
      );
    }
  }

  if (zipPath !== undefined) {
    if (!existsSync(zipPath)) problems.push(`${zipPath} is missing`);
    else {
      const zip = readFileSync(zipPath);
      const onDisk = new Map(files.map((f) => [f.name, f.data]));
      const packed = unzipEntries(zip);
      const same =
        packed.length === onDisk.size &&
        packed.every((e) => {
          const data = onDisk.get(e.name);
          return data !== undefined && Buffer.compare(e.data, data) === 0;
        });
      if (!same) problems.push(`${relative(process.cwd(), zipPath)} does not match ${relative(process.cwd(), dir)}`);
      // The archive must be a pure function of the folder (and SOURCE_DATE_EPOCH): rebuild and compare.
      const mtime = zip.length >= 14 ? dosToDate(zip.readUInt16LE(10), zip.readUInt16LE(12)) : undefined;
      if (sha256(zipEntries(files, { mtime })) !== sha256(zip)) problems.push(`${zipPath} is not reproducible`);
    }
  }
  return problems.map((p) => (p.startsWith(`${target}:`) ? p : `${target}: ${p}`));
}

/**
 * Reads back the timestamp of the first zip entry, so an archive built with SOURCE_DATE_EPOCH can
 * be re-created exactly.
 * @param {number} time
 * @param {number} day
 */
function dosToDate(time, day) {
  return new Date(
    Date.UTC(1980 + (day >> 9), ((day >> 5) & 15) - 1, day & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2),
  );
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { values } = parseArgs({ options: { target: { type: "string" }, dist: { type: "string" } } });
  const dist = values.dist ?? join(root, "dist");
  let failed = false;
  for (const target of parseTargets(values.target ?? "all")) {
    const dir = join(dist, target);
    const zipPath = join(dist, `${target}.zip`);
    const problems = auditPackage(dir, target, zipPath);
    if (problems.length > 0) {
      failed = true;
      console.error(`FAIL ${target}\n  - ${problems.join("\n  - ")}`);
    } else {
      const gz = gzipSync(readFileSync(join(dir, "swarm.js")), { level: 9 }).length;
      console.log(
        `ok   ${target}: swarm.js ${(gz / 1024).toFixed(1)} KB gzip, sha256(${target}.zip) ${sha256(readFileSync(zipPath))}`,
      );
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
