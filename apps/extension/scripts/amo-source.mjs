#!/usr/bin/env node
// Builds dist/firefox-amo-source.zip: the source package addons.mozilla.org reviewers need to rebuild
// dist/firefox.zip byte for byte (bundled, not minified code still requires sources).
//
// Usage: node scripts/amo-source.mjs [--verify]
//   --verify  unpack the archive into a temporary folder, install from the lockfile, rebuild the
//             Firefox package there and compare its sha256 with dist/firefox.zip.
//
// Contents: root workspace and lockfile files, every workspace package.json (so the lockfile installs
// unchanged), the sources of the extension and of each workspace package it bundles, brand icons when
// present, and AMO-SOURCE.md with the exact steps and expected hash.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { sha256 } from "./audit.mjs";
import { STUBBED_PACKAGES } from "./targets.mjs";
import { sourceDateEpoch, unzipEntries, zipEntries } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..", "..");
const dist = join(root, "dist");
const XPI = join(dist, "firefox.zip");
const OUT = join(dist, "firefox-amo-source.zip");

/** Repository files needed to install and build, copied when present. */
const ROOT_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".gitattributes",
  "tsconfig.base.json",
  "tsconfig.json",
  "LICENSE",
  "scripts/release/licenses/Apache-2.0.txt", // notices.mjs: the licence of the Draco decoders
  "scripts/release/licenses/OFL-1.1.txt", // notices.mjs: the licence of the KaTeX fonts
];
/** Workspace folders (pnpm-workspace.yaml: packages/*, apps/*). */
const WORKSPACE_DIRS = ["packages", "apps"];
/** Never part of a source package: installs, outputs, tests and local state. */
const SKIP_DIR = /^(node_modules|dist|dist-.*|build|test|tests|coverage|\..*)$/;
const SKIP_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|\.zip$/;

/**
 * @typedef {{ name: string; dir: string; workspaceDeps: string[] }} WorkspacePackage
 */

/** @returns {Map<string, WorkspacePackage>} workspace packages by name */
function workspacePackages() {
  /** @type {Map<string, WorkspacePackage>} */
  const out = new Map();
  for (const group of WORKSPACE_DIRS) {
    const base = join(repo, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const file = join(base, name, "package.json");
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      const deps = Object.entries({ ...pkg.dependencies })
        .filter(([, spec]) => typeof spec === "string" && spec.startsWith("workspace:"))
        .map(([dep]) => dep);
      out.set(pkg.name, { name: pkg.name, dir: join(base, name), workspaceDeps: deps });
    }
  }
  return out;
}

/**
 * Workspace packages whose sources end up in the package, starting from `roots`.
 * @param {Map<string, WorkspacePackage>} all
 * @param {string[]} roots
 * @param {boolean} withAdapters Studio is bundled, and Studio bundles the format adapters.
 */
function bundledPackages(all, roots, withAdapters) {
  /** @type {Set<string>} */
  const seen = new Set();
  const visit = (/** @type {string} */ name) => {
    if (seen.has(name) || (!withAdapters && STUBBED_PACKAGES.test(name))) return;
    const pkg = all.get(name);
    if (!pkg) throw new Error(`workspace package ${name} not found`);
    seen.add(name);
    for (const dep of pkg.workspaceDeps) visit(dep);
  };
  for (const r of roots) visit(r);
  return [...seen].sort();
}

/**
 * Adds every source file below `dir` (skipping outputs, tests and dot folders).
 * @param {string} dir
 * @param {Map<string, Buffer>} files keyed by repository-relative path
 */
function addTree(dir, files) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIR.test(name)) addTree(path, files);
    } else if (!SKIP_FILE.test(name)) {
      files.set(relative(repo, path).split(sep).join("/"), readFileSync(path));
    }
  }
}

/** @param {string} cmd @param {string[]} args @param {string} cwd */
function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, CI: "1" } });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed in ${cwd}`);
}

/**
 * @param {{ xpiHash: string; studio: boolean; packages: string[]; pnpm: string; epoch: string | undefined }} info
 */
function instructions(info) {
  const studioStep = info.studio
    ? [
        "pnpm -F @swarmloom/studio build:extension",
        "   (writes apps/studio/dist-extension, which the extension build bundles as studio/)",
      ]
    : [];
  const steps = [
    "pnpm install --frozen-lockfile",
    ...studioStep,
    `${info.epoch ? `SOURCE_DATE_EPOCH=${info.epoch} ` : ""}pnpm -F @swarmloom/extension exec node scripts/build.mjs --target firefox`,
    "sha256sum apps/extension/dist/firefox.zip",
  ];
  return `# SwarmLoom for Firefox: source package

This archive rebuilds \`firefox.zip\`, the package uploaded to addons.mozilla.org (one package for
Firefox desktop and Firefox for Android). The code is bundled with esbuild; it is neither minified
nor obfuscated. Third-party code comes from registry.npmjs.org as pinned by \`pnpm-lock.yaml\`.

## Environment

- Node.js ${process.version} (the same major version is required: zip compression comes from Node's zlib)
- pnpm ${info.pnpm} (\`corepack enable\` picks it from package.json)
- Any OS; the build does not depend on the working directory or the clock.

## Steps (from the folder this archive was unpacked into)

${steps.map((s, i) => (s.startsWith("   ") ? s : `${i + 1}. ${s}`)).join("\n")}

Expected sha256 of \`apps/extension/dist/firefox.zip\`:

    ${info.xpiHash}

## Layout

- \`apps/extension\`: background script, content script, extension pages and the build scripts
  (\`scripts/build.mjs\`, \`scripts/manifest.mjs\`, \`scripts/zip.mjs\`).
- Bundled workspace packages: ${info.packages.map((p) => `\`${p}\``).join(", ")}.
- Other \`package.json\` files are included only so the lockfile installs unchanged.
`;
}

/** @param {Buffer} archive @param {string} expected */
function verify(archive, expected) {
  const work = mkdtempSync(join(tmpdir(), "swarmloom-amo-"));
  try {
    for (const { name, data } of unzipEntries(archive)) {
      const path = join(work, ...name.split("/"));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
    }
    run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], work);
    if (existsSync(join(work, "apps", "studio", "package.json")) && existsSync(join(work, "apps", "studio", "src"))) {
      run("pnpm", ["-F", "@swarmloom/studio", "build:extension"], work);
    }
    run("pnpm", ["-F", "@swarmloom/extension", "exec", "node", "scripts/build.mjs", "--target", "firefox"], work);
    const rebuilt = sha256(readFileSync(join(work, "apps", "extension", "dist", "firefox.zip")));
    if (rebuilt !== expected)
      throw new Error(`rebuilt firefox.zip ${rebuilt} differs from dist/firefox.zip ${expected}`);
    console.log(`verified: a clean rebuild from the source package matches (${expected})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const { values } = parseArgs({ options: { verify: { type: "boolean", default: false } } });
  if (!existsSync(XPI))
    throw new Error(`missing ${relative(repo, XPI)}; run "pnpm -F @swarmloom/extension build" first`);
  const xpiHash = sha256(readFileSync(XPI));
  const studio = existsSync(join(dist, "firefox", "studio"));
  const rootPkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const pnpm = String(rootPkg.packageManager ?? "pnpm").replace(/^pnpm@/, "");
  const epoch = process.env.SOURCE_DATE_EPOCH || undefined;
  const mtime = sourceDateEpoch(epoch);

  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (const name of ROOT_FILES) {
    if (existsSync(join(repo, name))) files.set(name, readFileSync(join(repo, name)));
  }
  const all = workspacePackages();
  for (const pkg of all.values())
    files.set(
      relative(repo, join(pkg.dir, "package.json")).split(sep).join("/"),
      readFileSync(join(pkg.dir, "package.json")),
    );
  const roots = ["@swarmloom/extension", ...(studio ? ["@swarmloom/studio"] : [])];
  const packages = bundledPackages(all, roots, studio);
  for (const name of packages) addTree(/** @type {WorkspacePackage} */ (all.get(name)).dir, files);
  const brand = join(repo, "assets", "brand");
  if (existsSync(brand)) {
    for (const name of readdirSync(brand)) {
      if (/^icon-\d+\.png$/.test(name)) files.set(`assets/brand/${name}`, readFileSync(join(brand, name)));
    }
  }
  files.set("AMO-SOURCE.md", Buffer.from(instructions({ xpiHash, studio, packages, pnpm, epoch })));

  const archive = zipEntries(
    [...files].map(([name, data]) => ({ name, data })),
    { mtime },
  );
  writeFileSync(OUT, archive);
  console.log(
    `wrote ${relative(root, OUT)} (${files.size} files, ${(archive.length / 1024).toFixed(0)} KiB, sha256 ${sha256(archive)}) for firefox.zip ${xpiHash}`,
  );
  if (values.verify) verify(archive, xpiHash);
}

main();
