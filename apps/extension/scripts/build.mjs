#!/usr/bin/env node
// Builds the unpacked extension for each target into dist/<target>/ and zips it to dist/<target>.zip.
// Every package carries THIRD_PARTY_NOTICES.txt (scripts/notices.mjs) and SwarmLoom's LICENSE.txt.
//
// Usage: node scripts/build.mjs [--target all|chrome,edge,firefox,safari]
//                               [--e2e] [--studio <dir>] [--no-zip]
//
//   --e2e     Test build into dist-e2e/<target>/: exposes globalThis.__swarmloomTest in the
//             background and grants <all_urls> so Playwright can drive it. Never shipped.
//   --studio  Studio build made with STUDIO_TARGET=extension (default: $SWARMLOOM_STUDIO_DIR, then
//             ../studio/dist-extension). Copied to studio/ when present; the build works without it.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { placeholderIcon } from "./icons.mjs";
import { ICON_SIZES, manifestFor, messageKeys, referencedFiles, validateManifest } from "./manifest.mjs";
import {
  bundledPackages,
  collectNotices,
  dependencyClosure,
  LICENSE_COPY,
  NOTICES_FILE,
  renderNotices,
} from "./notices.mjs";
import { parseTargets, STUBBED_PACKAGES, TARGETS } from "./targets.mjs";
import { directoryEntries, sourceDateEpoch, zipEntries } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..", "..");

/** Locale files in src/locales and their `_locales` folder names. */
const LOCALE_DIRS = Object.freeze({
  en: "en",
  "zh-CN": "zh_CN",
  "zh-TW": "zh_TW",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
});

/**
 * The extension plays live pages only (snapshot-dom + core). Documents open in Studio, so format
 * adapters reachable through `@swarmloom/formats` (used by `<swarm-loom>` on the welcome page) are
 * replaced by a module that fails when loaded. This keeps pdf.js and friends out of the package.
 * @type {import("esbuild").Plugin}
 */
const noFormatAdapters = {
  name: "swarmloom-no-format-adapters",
  setup(b) {
    b.onResolve({ filter: STUBBED_PACKAGES }, (args) => ({ path: args.path, namespace: "swarmloom-no-adapter" }));
    b.onLoad({ filter: /.*/, namespace: "swarmloom-no-adapter" }, (args) => ({
      contents: `throw new Error(${JSON.stringify(`${args.path} is not part of the extension; open the file in Studio`)});`,
      loader: "js",
    }));
  },
};

/** Chrome Web Store, AMO and Edge limits. */
const MAX_NAME = 45;
const MAX_DESCRIPTION = 132;

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    browser: { type: "string" },
    e2e: { type: "boolean", default: false },
    studio: { type: "string" },
    "no-zip": { type: "boolean", default: false },
  },
});

const targets = parseTargets(values.target ?? values.browser ?? "all");
const e2e = values.e2e === true;
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outRoot = join(root, e2e ? "dist-e2e" : "dist");

/** @returns {Record<string, Record<string, string>>} */
function readCatalogs() {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  for (const locale of Object.keys(LOCALE_DIRS)) {
    const catalog = JSON.parse(readFileSync(join(root, "src", "locales", `${locale}.json`), "utf8"));
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== "string") throw new Error(`${locale}.json: ${key} is not a string`);
      // `$` starts a placeholder in the WebExtension i18n format; the catalogs use {name} instead.
      if (value.includes("$")) throw new Error(`${locale}.json: ${key} contains "$"`);
    }
    out[locale] = catalog;
  }
  return out;
}

/** @returns {{ dir: string; entry: string } | null} */
function findStudio() {
  const candidates = [values.studio, process.env.SWARMLOOM_STUDIO_DIR, join(repo, "apps", "studio", "dist-extension")];
  for (const dir of candidates) {
    if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const entry of ["studio.html", "index.html"]) {
      if (existsSync(join(dir, entry))) return { dir, entry };
    }
  }
  return null;
}

/** @param {string} out */
function writeIcons(out) {
  mkdirSync(join(out, "icons"), { recursive: true });
  let generated = 0;
  for (const size of ICON_SIZES) {
    const brand = join(repo, "assets", "brand", `icon-${size}.png`);
    const target = join(out, "icons", `icon-${size}.png`);
    if (existsSync(brand)) cpSync(brand, target);
    else {
      writeFileSync(target, placeholderIcon(size));
      generated++;
    }
  }
  return generated;
}

/**
 * @param {string} out
 * @param {Record<string, Record<string, string>>} catalogs
 * @param {Set<string>} keys
 */
function writeLocales(out, catalogs, keys) {
  for (const [locale, dir] of Object.entries(LOCALE_DIRS)) {
    const catalog = catalogs[locale] ?? {};
    /** @type {Record<string, { message: string }>} */
    const messages = {};
    for (const key of [...keys].sort()) {
      const message = catalog[key];
      if (typeof message !== "string") throw new Error(`${locale}.json is missing manifest key ${key}`);
      messages[key] = { message };
    }
    mkdirSync(join(out, "_locales", dir), { recursive: true });
    writeFileSync(join(out, "_locales", dir, "messages.json"), `${JSON.stringify(messages, null, 2)}\n`);
  }
}

/**
 * @param {import("./targets.mjs").TargetId} target
 * @param {string} out
 * @param {string} studioEntry
 * @returns {Promise<import("esbuild").Metafile[]>} what each build bundled, for the licence notices
 */
async function bundle(target, out, studioEntry) {
  const spec = TARGETS[target];
  /** @type {import("esbuild").BuildOptions} */
  const common = {
    bundle: true,
    target: [...spec.esbuild],
    platform: "browser",
    conditions: ["@swarmloom/source"],
    charset: "utf8",
    logLevel: "warning",
    plugins: [noFormatAdapters],
    // Whitespace and syntax minification keeps the content script inside its 150 KB gzip budget,
    // while identifiers stay unmangled so store reviewers (AMO in particular) can still read the
    // shipped code; the AMO source package rebuilds it byte for byte.
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: false,
    // Path comments in the output are relative to this directory, whatever the caller's cwd, so a
    // reviewer rebuilding from the source package gets byte-identical files.
    absWorkingDir: root,
    metafile: true,
    define: {
      __SWARMLOOM_TARGET__: JSON.stringify(target),
      __SWARMLOOM_STUDIO__: JSON.stringify(studioEntry),
    },
  };
  const scripts = [
    // The e2e entry adds the test hook; store builds never contain it.
    [e2e ? "src/background/e2e.ts" : "src/background/index.ts", "background.js"],
    ["src/content/main.ts", "swarm.js"],
    ["src/content/tracker-main.ts", "tracker.js"],
  ];
  const results = await Promise.all([
    ...scripts.map(([entry, file]) =>
      build({ ...common, entryPoints: [join(root, entry ?? "")], outfile: join(out, file ?? ""), format: "iife" }),
    ),
    build({
      ...common,
      entryPoints: ["options", "welcome", "notice", "demo"].map((p) => join(root, "src", "pages", `${p}.ts`)),
      outdir: join(out, "pages"),
      format: "esm",
      splitting: true,
      chunkNames: "chunks/[name]-[hash]",
    }),
  ]);
  return results.map((result) => /** @type {import("esbuild").Metafile} */ (result.metafile));
}

/**
 * Writes the third-party notices of everything in the package, and SwarmLoom's own licence.
 * @param {string} out
 * @param {import("esbuild").Metafile[]} metafiles
 * @param {readonly string[]} studioPackages dependency closure of the bundled Studio, or none
 */
function writeNotices(out, metafiles, studioPackages) {
  const notices = collectNotices([...bundledPackages(metafiles, root), ...studioPackages]);
  writeFileSync(join(out, NOTICES_FILE), renderNotices(notices));
  cpSync(join(repo, "LICENSE"), join(out, LICENSE_COPY));
}

/**
 * @param {string} out
 * @param {Record<string, unknown>} manifest
 * @param {import("./targets.mjs").TargetId} target
 * @param {Record<string, Record<string, string>>} catalogs
 */
function validate(out, manifest, target, catalogs) {
  const problems = validateManifest(manifest, target, { allowHostPermissions: e2e });
  for (const file of [
    ...referencedFiles(manifest),
    "swarm.js",
    "tracker.js",
    "welcome.html",
    "notice.html",
    "demo.html",
    NOTICES_FILE,
    LICENSE_COPY,
  ]) {
    if (!existsSync(join(out, file))) problems.push(`missing file ${file}`);
  }
  for (const [locale, catalog] of Object.entries(catalogs)) {
    if ((catalog.extName ?? "").length > MAX_NAME) problems.push(`${locale}: extName longer than ${MAX_NAME}`);
    if ((catalog.extDescription ?? "").length > MAX_DESCRIPTION) {
      problems.push(`${locale}: extDescription longer than ${MAX_DESCRIPTION}`);
    }
  }
  if (problems.length > 0) throw new Error(`${target}: invalid build\n  - ${problems.join("\n  - ")}`);
}

/** @param {string} dir */
function dirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    total += statSync(path).isDirectory() ? dirSize(path) : statSync(path).size;
  }
  return total;
}

const catalogs = readCatalogs();
const studio = findStudio();
if (!studio) {
  console.log("note: no Studio extension build found; Studio links use the hosted Studio");
}
// Vite bundles the Studio from its runtime dependencies; their notices ship with the copy.
const studioPackages = studio ? dependencyClosure(join(repo, "apps", "studio")) : [];

mkdirSync(outRoot, { recursive: true });
for (const target of targets) {
  const out = join(outRoot, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, "public"), out, { recursive: true });

  const studioEntry = studio ? `studio/${studio.entry}` : "";
  if (studio) cpSync(studio.dir, join(out, "studio"), { recursive: true });

  const manifest = manifestFor(target, version, e2e ? { hostPermissions: ["<all_urls>"] } : {});
  writeLocales(out, catalogs, messageKeys(manifest));
  const generatedIcons = writeIcons(out);
  const metafiles = await bundle(target, out, studioEntry);
  writeNotices(out, metafiles, studioPackages);
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  validate(out, manifest, target, catalogs);

  let line = `built ${relative(root, out)} (${(dirSize(out) / 1024).toFixed(0)} KiB`;
  if (generatedIcons > 0) line += ", placeholder icons";
  if (studio) line += ", bundled Studio";
  line += ")";
  if (!e2e && values["no-zip"] !== true) {
    const zipPath = join(outRoot, `${target}.zip`);
    const zip = zipEntries(directoryEntries(out), { mtime: sourceDateEpoch(process.env.SOURCE_DATE_EPOCH) });
    writeFileSync(zipPath, zip);
    line += ` -> ${relative(root, zipPath)} (${(zip.length / 1024).toFixed(0)} KiB)`;
  }
  console.log(line);
}
