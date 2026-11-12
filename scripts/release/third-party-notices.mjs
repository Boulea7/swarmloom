#!/usr/bin/env node
// @ts-check
/**
 * Third-party licences for published npm packages. A public package whose tarball bundles code or
 * assets from npm dependencies gets a generated LICENSE.md at its root: the repository's MIT licence,
 * then the full licence (and NOTICE, if any) of every bundled package. npm and pnpm always pack a root
 * LICENSE* file whatever `files` says, and the file survives `prepublishOnly` rebuilds that empty dist/.
 * Packages that bundle nothing get no LICENSE.md and receive the repository LICENSE from pnpm pack.
 *
 * The files are build output: the release jobs and `pnpm release` write them right before packing, and
 * they are never committed (the package directories belong to their packages, and a committed copy goes
 * stale with every dependency update).
 *
 * What a package bundles:
 * - packages in BUNDLES_DEPENDENCIES (app and CDN builds) bundle their whole runtime tree: every
 *   workspace package they reach, and the third-party dependencies of those, recursively;
 * - every other public package is a tsup library build that keeps `dependencies`, `peerDependencies`
 *   and `optionalDependencies` external, so it bundles only what its sources import from elsewhere
 *   (with that package's own dependencies) and the files it inlines with `?raw`, `?inline` or `?url`.
 * The result may name a package that tree-shaking removes again; it does not leave one out.
 *
 * Modes (each fails when a bundled package ships no licence text, or an MPL-2.0 one no copyright line
 * (HEADER_COPYRIGHTS), when a hand-written LICENSE.md is in the way, or when a built dist/ holds a module
 * path, from an esbuild comment or a source map, of a package the notices do not cover):
 * - default: write the LICENSE.md files (and delete generated ones no longer needed);
 * - `--check`: write nothing; also fails when a generated LICENSE.md on disk is stale;
 * - `--clean`: delete the generated LICENSE.md files after a local release;
 * - `--pages <dir>`: write a LICENSE.md into each app folder of the assembled GitHub Pages artifact
 *   instead (PAGES_APPS); the npm packages are left alone;
 * - `--app <name> <dir>`: write the LICENSE.md of one PAGES_APPS app into its build folder (the bookmarklet
 *   Release ZIP is packed from apps/bookmarklet/dist).
 * An app's LICENSE.md holds at least SwarmLoom's licence: unlike an npm tarball, nothing else adds it.
 *
 * Usage: node scripts/release/third-party-notices.mjs [--check | --clean | --pages <dir> | --app <name> <dir>]
 */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readWorkspacePackages } from "./check-packages.mjs";
import { runIfMain } from "./lib/cli.mjs";
import { compareCodeUnits, listFiles } from "./lib/files.mjs";
import { isRecord, readJson } from "./lib/json.mjs";
import {
  bundledPackagesInOutput,
  GENERATED_MARKER,
  hasCopyrightLine,
  headerCopyright,
  legalFiles,
  licenseOf,
  mitLicense,
  readmeLicenseSection,
  renderLicenseFile,
  repositoryUrl,
  runtimeImports,
  synthesizedMitLicense,
} from "./lib/notices.mjs";

/** @typedef {import("./check-packages.mjs").WorkspacePackage} WorkspacePackage */
/** @typedef {import("./lib/notices.mjs").NoticeEntry} NoticeEntry */

/**
 * @typedef {object} WholeTreeBuild
 * @property {string} where the outputs that bundle the tree
 * @property {readonly string[]} external third-party dependencies the build leaves to npm
 * @property {readonly string[]} [inlined] third-party packages whose files the build reads from disk
 *   (require.resolve, fs) instead of importing them, so the source scan cannot see them
 * @property {Readonly<Record<string, readonly string[]>>} [frameworks] framework packages whose client code
 *   the build emits, each with the dependencies that client uses at run time (added with their dependency
 *   trees, as installed for the framework); the framework's other dependencies are build tools
 */

/** @type {ReadonlyMap<string, WholeTreeBuild>} Public packages whose build bundles the whole runtime tree. */
export const BUNDLES_DEPENDENCIES = new Map([
  [
    "swarmloom",
    {
      where:
        "dist/cli.js bundles @swarmloom/formats; dist/studio and dist/render are the Studio and render page builds",
      external: ["playwright-core"],
    },
  ],
  [
    "@swarmloom/element",
    { where: "dist/swarm-loom.global.js, dist/swarm-loom.adapters.js and dist/chunks are CDN builds", external: [] },
  ],
  ["@swarmloom/export", { where: "dist/render is the headless render page with every adapter", external: [] }],
]);

/**
 * @typedef {object} PagesApp
 * @property {string} path folder of the Pages artifact the app's build is copied to ("" for the root)
 * @property {WholeTreeBuild} build
 * @property {string} [dir] source folder of an app that is not a workspace package (the key is then only
 *   a label): it bundles the workspace packages its sources import and what `build` lists
 */

/**
 * Apps deployed to GitHub Pages (.github/workflows/pages.yml): the private Vite or esbuild app builds,
 * which bundle their whole runtime tree, and the VitePress docs. Their LICENSE.md lands next to the
 * app's index.html.
 * @type {ReadonlyMap<string, PagesApp>}
 */
export const PAGES_APPS = new Map([
  [
    "@swarmloom/site",
    {
      path: "",
      build: {
        where: "the page inlines the Phosphor SVG icons and copies the Bricolage Grotesque font",
        external: [],
        inlined: ["@phosphor-icons/core", "@fontsource-variable/bricolage-grotesque"],
      },
    },
  ],
  ["@swarmloom/studio", { path: "studio", build: { where: "the Studio PWA with every adapter", external: [] } }],
  ["@swarmloom/bookmarklet", { path: "bm", build: { where: "bm/swarm.js and its install page", external: [] } }],
  [
    // Built by the root devDependency vitepress. Its GitHub icon in vp-icons.css is from Simple Icons
    // (CC0-1.0, no notice required); Shiki highlights at build time and leaves no code behind.
    "swarmloom-docs",
    {
      path: "docs",
      dir: "docs",
      build: {
        where: "the VitePress client: Vue, the default theme with its Inter font and DocSearch styles, local search",
        external: [],
        frameworks: {
          vitepress: [
            "vue",
            "@vueuse/core",
            "@vueuse/integrations",
            "@docsearch/css",
            "focus-trap",
            "mark.js",
            "minisearch",
          ],
        },
      },
    },
  ],
]);

/**
 * @typedef {object} EmbeddedPackage
 * @property {string} host installed package whose files contain this one, pre-bundled
 * @property {string} files where in the host the embedded code lives
 * @property {"MIT" | "Apache-2.0" | "OFL-1.1"} license
 * @property {string} source
 * @property {string} copyright the copyright line of the embedded code (from its files or its upstream sources)
 */

/**
 * Packages that a dependency ships pre-bundled inside its own files, so they are never installed and have
 * no licence file to read. Listed whenever their host is bundled.
 * @type {ReadonlyMap<string, EmbeddedPackage>}
 */
export const EMBEDDED_PACKAGES = new Map([
  [
    "core-js",
    {
      host: "pdfjs-dist",
      files: "legacy/build/*.mjs", // the copyright string is in the core-js shared-store code
      license: "MIT",
      source: "https://github.com/zloirock/core-js",
      copyright: "2013–2025 Denis Pushkarev (zloirock.ru), 2025–2026 CoreJS Company (core-js.io)",
    },
  ],
  [
    "draco3d",
    {
      host: "three",
      files: "examples/jsm/libs/draco/", // DRACOLoader's decoders; Vite emits the .js and .wasm files
      license: "Apache-2.0",
      source: "https://github.com/google/draco",
      copyright: "2016 The Draco Authors", // the line of the Draco sources; the repository has no NOTICE
    },
  ],
  [
    "meshoptimizer",
    {
      host: "three",
      files: "examples/jsm/libs/meshopt_decoder.module.js", // GLTFLoader's EXT_meshopt_compression decoder
      license: "MIT",
      source: "https://github.com/zeux/meshoptimizer",
      copyright: "2016-2026 Arseny Kapoulkine",
    },
  ],
  [
    "Inter",
    {
      host: "vitepress",
      files: "dist/client/theme-default/fonts/", // the default theme's woff2 files; Vite emits them
      license: "OFL-1.1",
      source: "https://github.com/rsms/inter",
      copyright: "2016 The Inter Project Authors (https://github.com/rsms/inter)", // the fonts' name table
    },
  ],
  [
    "KaTeX fonts",
    {
      host: "katex",
      files: "dist/fonts/", // the woff2 files @swarmloom/adapter-markdown inlines (src/math/katex-assets.ts)
      license: "OFL-1.1",
      source: "https://github.com/KaTeX/katex-fonts",
      // The fonts' name table (description, name ID 13), with the Reserved Font Name of every font.
      copyright:
        "(c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)\n" +
        "Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>),\n" +
        "with Reserved Font Names KaTeX_AMS, KaTeX_Caligraphic, KaTeX_Fraktur, KaTeX_Main, KaTeX_Math, " +
        "KaTeX_SansSerif, KaTeX_Script, KaTeX_Size1, KaTeX_Size2, KaTeX_Size3, KaTeX_Size4, KaTeX_Typewriter.",
    },
  ],
]);

/**
 * MPL-2.0 packages whose licence file carries no copyright line: they state it in the header comment of
 * every source file (MPL-2.0 Exhibit A), which minified builds drop, so the notice repeats the copyright
 * lines of the named file's header. A bundled MPL-2.0 package must be listed here unless its licence file
 * names the holder. Keep in step with HEADER_COPYRIGHTS in apps/extension/scripts/notices.mjs.
 * @type {ReadonlyMap<string, string>} package name -> file of the package whose header holds the copyright
 */
export const HEADER_COPYRIGHTS = new Map([
  ["dompurify", "dist/purify.es.mjs"],
  ["mediabunny", "dist/modules/src/index.js"],
]);

/**
 * Full licence texts for embedded packages that are not MIT: Apache-2.0 as in google/draco's LICENSE,
 * OFL-1.1 as SIL publishes it (the copyright line goes above it).
 */
const LICENSE_TEXTS = {
  "Apache-2.0": new URL("./licenses/Apache-2.0.txt", import.meta.url),
  "OFL-1.1": new URL("./licenses/OFL-1.1.txt", import.meta.url),
};

/**
 * Notice entry of a package pre-bundled inside another one.
 * @param {string} name
 * @param {EmbeddedPackage} embedded
 * @returns {NoticeEntry}
 */
export function embeddedEntry(name, embedded) {
  const note = `Pre-bundled inside ${embedded.host} (${embedded.files}), which ships no separate licence file for it.`;
  const text =
    embedded.license === "MIT"
      ? mitLicense(embedded.copyright, note)
      : `Copyright ${embedded.copyright}\n\n${readFileSync(LICENSE_TEXTS[embedded.license], "utf8").trimEnd()}\n\n(${note})`;
  return { name, license: embedded.license, source: embedded.source, text };
}

export const LICENSE_FILE = "LICENSE.md";
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|html|css)$/;
const SKIPPED_FILE = /\.(?:test|spec|config)\.[^.]+$|\.d\.[cm]?ts$|^(?:vite|vitest|tsup)\.config\./;
const SKIPPED_DIR = /^(?:node_modules|dist.*|test|tests|e2e|scripts|build|coverage|public)$/;
const DIST_FILE = /\.(?:[cm]?js|css|map)$/;

/** @type {Map<string, Map<string, boolean>>} */
const importCache = new Map();

/**
 * Runtime imports of a workspace package's shipped sources (tests, scripts, build plugins and configs excluded).
 * @param {string} dir absolute package directory
 * @returns {Map<string, boolean>} package name -> imported as an inlined asset somewhere
 */
function sourceImports(dir) {
  const cached = importCache.get(dir);
  if (cached) return cached;
  /** @type {Map<string, boolean>} */
  const imports = new Map();
  importCache.set(dir, imports);
  const files = listFiles(dir, (path) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return statSync(join(dir, path)).isDirectory() ? !SKIPPED_DIR.test(name) : !SKIPPED_FILE.test(name);
  }).filter((path) => SOURCE_FILE.test(path));
  for (const file of files) {
    for (const { name, asset } of runtimeImports(readFileSync(join(dir, file), "utf8"))) {
      if (!isBuiltin(name)) imports.set(name, (imports.get(name) ?? false) || asset);
    }
  }
  return imports;
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {readonly string[]} fields
 * @returns {string[]}
 */
function dependencyNames(manifest, fields) {
  return fields.flatMap((field) => (isRecord(manifest[field]) ? Object.keys(manifest[field]) : []));
}

/**
 * Node-style lookup of an installed package from a directory (follows pnpm's symlinked layout).
 * @param {string} fromDir
 * @param {string} name
 * @returns {string | null} real path of the package directory
 */
function resolvePackage(fromDir, name) {
  let dir = realpathSync(fromDir);
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Collects the third-party packages bundled into a public workspace package.
 * @param {WorkspacePackage} pkg
 * @param {ReadonlyMap<string, WorkspacePackage>} workspace by package name
 * @param {string} root repository root
 * @param {WholeTreeBuild} [wholeTree] how the package bundles its tree; default from BUNDLES_DEPENDENCIES
 * @returns {Map<string, string>} real package directory -> package name
 */
export function bundledPackages(pkg, workspace, root, wholeTree = BUNDLES_DEPENDENCIES.get(String(pkg.manifest.name))) {
  const external = wholeTree?.external ?? [];
  /** @type {Map<string, string>} */
  const found = new Map();
  /** Directories whose dependencies have been added already. */
  const expanded = new Set();
  /**
   * Adds a third-party package and, unless only its files are inlined, its dependency tree.
   * @param {string} fromDir
   * @param {string} name
   * @param {boolean} withDependencies
   * @returns {string | null} real package directory (null for @types packages)
   */
  const addThirdParty = (fromDir, name, withDependencies) => {
    if (name.startsWith("@types/")) return null; // declarations only, nothing reaches a bundle
    const dir = resolvePackage(fromDir, name);
    if (!dir) throw new Error(`${name} is not installed (needed from ${relative(root, fromDir) || "."})`);
    found.set(dir, name);
    if (!withDependencies || expanded.has(dir)) return dir;
    expanded.add(dir);
    const manifest = readJson(join(dir, "package.json"));
    if (!isRecord(manifest)) throw new Error(`${dir}/package.json is not a JSON object`);
    // Optional dependencies of npm packages are native or platform add-ons that bundlers cannot inline.
    for (const dep of dependencyNames(manifest, ["dependencies"])) {
      addThirdParty(dir, dep, true);
    }
    return dir;
  };

  /** @type {Set<string>} */
  const visited = new Set();
  /**
   * Adds a workspace package whose sources are bundled, with everything they use at run time:
   * dependencies, devDependencies its sources import, and workspace packages it reaches. The package
   * being published also bundles its workspace devDependencies (the CLI copies the Studio build).
   * @param {WorkspacePackage} member
   */
  const addWholeTree = (member) => {
    const name = String(member.manifest.name);
    if (visited.has(name)) return;
    visited.add(name);
    const dir = join(root, member.dir);
    const imports = sourceImports(dir);
    const devDependencies = dependencyNames(member.manifest, ["devDependencies"]);
    const used = new Set([
      ...dependencyNames(member.manifest, ["dependencies", "optionalDependencies"]),
      ...devDependencies.filter((dep) => imports.has(dep) || (member === pkg && workspace.has(dep))),
      ...[...imports.keys()].filter((dep) => workspace.has(dep)),
    ]);
    for (const dep of [...used].sort(compareCodeUnits)) {
      const nested = workspace.get(dep);
      if (nested) addWholeTree(nested);
      else if (!(member === pkg && external.includes(dep))) addThirdParty(dir, dep, true);
    }
  };

  if (wholeTree) {
    addWholeTree(pkg);
    for (const name of wholeTree.inlined ?? []) addThirdParty(join(root, pkg.dir), name, false);
    for (const [framework, runtime] of Object.entries(wholeTree.frameworks ?? {})) {
      const frameworkDir = addThirdParty(join(root, pkg.dir), framework, false);
      if (frameworkDir) for (const name of runtime) addThirdParty(frameworkDir, name, true);
    }
    return found;
  }
  const dir = join(root, pkg.dir);
  const declared = new Set(dependencyNames(pkg.manifest, ["dependencies", "peerDependencies", "optionalDependencies"]));
  const devDependencies = new Set(dependencyNames(pkg.manifest, ["devDependencies"]));
  for (const [name, asset] of sourceImports(dir)) {
    const member = workspace.get(name);
    if (member) {
      if (!declared.has(name) && name !== pkg.manifest.name) addWholeTree(member);
    } else if (asset) {
      addThirdParty(dir, name, false);
    } else if (!declared.has(name) && devDependencies.has(name)) {
      addThirdParty(dir, name, true);
    }
  }
  return found;
}

/**
 * Licence and notice texts of an installed package.
 * @param {string} dir real package directory
 * @returns {NoticeEntry}
 */
export function noticeEntry(dir) {
  const manifest = readJson(join(dir, "package.json"));
  if (!isRecord(manifest) || typeof manifest.name !== "string") throw new Error(`${dir}/package.json has no name`);
  const files = readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile());
  const { licenses, notices } = legalFiles(files);
  const texts = [...licenses, ...notices].map((file) => readFileSync(join(dir, file), "utf8").trim());
  if (licenses.length === 0) {
    const readmeFile = files.find((name) => /^readme(?:\.[\w]+)?$/i.test(name));
    const readme = readmeFile ? readFileSync(join(dir, readmeFile), "utf8") : "";
    const section = readmeLicenseSection(readme) ?? synthesizedMitLicense(manifest, readme);
    if (!section) {
      throw new Error(`${manifest.name} ships no licence text; replace the dependency or vendor its licence`);
    }
    texts.unshift(section);
  }
  const license = licenseOf(manifest);
  const headerFile = HEADER_COPYRIGHTS.get(manifest.name);
  if (headerFile !== undefined) {
    const path = join(dir, headerFile);
    const copyright = existsSync(path) ? headerCopyright(readFileSync(path, "utf8")) : null;
    if (!copyright) {
      throw new Error(`${manifest.name}: no copyright line in the header of ${headerFile}; update HEADER_COPYRIGHTS`);
    }
    texts.unshift(copyright);
  } else if (/\bMPL-2\.0\b/.test(license) && !texts.some(hasCopyrightLine)) {
    throw new Error(
      `${manifest.name} is under MPL-2.0 and its licence file names no copyright holder; ` +
        "add the file whose header does to HEADER_COPYRIGHTS",
    );
  }
  const text = texts.join("\n\n");
  return { name: manifest.name, license, source: repositoryUrl(manifest), text };
}

/**
 * @typedef {object} LicenseFile
 * @property {WorkspacePackage} pkg
 * @property {string} path where the LICENSE.md goes
 * @property {string | null} contents null when an npm package bundles no third-party code (pnpm pack adds
 *   the repository LICENSE instead)
 * @property {Set<string>} covered names of the packages the file covers
 */

/**
 * LICENSE.md of one workspace package: the repository licence, then every bundled third-party package.
 * @param {WorkspacePackage} pkg
 * @param {ReadonlyMap<string, WorkspacePackage>} workspace by package name
 * @param {string} root repository root
 * @param {string} path where the file goes
 * @param {WholeTreeBuild} [wholeTree] see bundledPackages
 * @param {boolean} [standalone] the file is the only licence shipped (an app folder): never null
 * @returns {LicenseFile}
 */
function licenseFile(pkg, workspace, root, path, wholeTree, standalone = false) {
  /** @type {Map<string, NoticeEntry>} */
  const entries = new Map();
  for (const dir of bundledPackages(pkg, workspace, root, wholeTree).keys()) {
    const entry = noticeEntry(dir);
    entries.set(`${entry.name}\n${entry.text}`, entry);
    for (const [name, embedded] of EMBEDDED_PACKAGES) {
      if (embedded.host !== entry.name) continue;
      const inner = embeddedEntry(name, embedded);
      entries.set(`${name}\n${inner.text}`, inner);
    }
  }
  const list = [...entries.values()];
  const ownLicense = readFileSync(join(root, "LICENSE"), "utf8");
  return {
    pkg,
    path,
    contents: list.length || standalone ? renderLicenseFile(String(pkg.manifest.name), ownLicense, list) : null,
    covered: new Set(list.map((entry) => entry.name)),
  };
}

/** @param {string} root */
function workspaceByName(root) {
  const packages = readWorkspacePackages(root);
  return { packages, workspace: new Map(packages.map((pkg) => [String(pkg.manifest.name), pkg])) };
}

/**
 * Expected LICENSE.md contents of every public workspace package (null: the package needs none).
 * @param {string} root
 * @returns {LicenseFile[]}
 */
export function expectedLicenseFiles(root) {
  const { packages, workspace } = workspaceByName(root);
  return packages
    .filter((pkg) => pkg.manifest.private !== true)
    .map((pkg) => licenseFile(pkg, workspace, root, join(root, pkg.dir, LICENSE_FILE)));
}

/**
 * @param {string} root
 * @param {ReadonlyMap<string, WorkspacePackage>} workspace
 * @param {string} name
 * @param {PagesApp} app
 * @param {string} folder where the app's build is, absolute or relative to `root`
 * @returns {LicenseFile}
 */
function pagesAppLicenseFile(root, workspace, name, app, folder) {
  const pkg = app.dir === undefined ? workspace.get(name) : { dir: app.dir, manifest: { name, private: true } };
  if (!pkg) throw new Error(`${name} (PAGES_APPS) is not a workspace package`);
  return licenseFile(pkg, workspace, root, resolve(root, folder, LICENSE_FILE), app.build, true);
}

/**
 * LICENSE.md of every app in PAGES_APPS, placed in the app's folder of the Pages artifact.
 * @param {string} root
 * @param {string} siteDir the assembled artifact, absolute or relative to `root`
 * @returns {LicenseFile[]}
 */
export function pagesLicenseFiles(root, siteDir) {
  const { workspace } = workspaceByName(root);
  return [...PAGES_APPS].map(([name, app]) => pagesAppLicenseFile(root, workspace, name, app, join(siteDir, app.path)));
}

/**
 * LICENSE.md of one PAGES_APPS app, placed in a folder holding its build.
 * @param {string} root
 * @param {string} name
 * @param {string} folder absolute or relative to `root`
 * @returns {LicenseFile}
 */
export function appLicenseFile(root, name, folder) {
  const app = PAGES_APPS.get(name);
  if (!app) throw new Error(`${name} is not in PAGES_APPS (${[...PAGES_APPS.keys()].join(", ")})`);
  return pagesAppLicenseFile(root, workspaceByName(root).workspace, name, app, folder);
}

/**
 * Third-party packages whose module paths appear in a built dist/ but are not covered.
 * @param {string} distDir
 * @param {ReadonlySet<string>} covered
 * @param {ReadonlySet<string>} workspaceNames
 * @returns {string[]}
 */
export function uncoveredInDist(distDir, covered, workspaceNames) {
  if (!existsSync(distDir)) return [];
  const missing = new Set();
  for (const file of listFiles(distDir).filter((path) => DIST_FILE.test(path))) {
    for (const name of bundledPackagesInOutput(readFileSync(join(distDir, file), "utf8"))) {
      if (!covered.has(name) && !workspaceNames.has(name)) missing.add(`${name} (${file})`);
    }
  }
  return [...missing].sort(compareCodeUnits);
}

/**
 * Problems for every third-party package a built dist/ bundles without a notice.
 * @param {WorkspacePackage} pkg
 * @param {string} root
 * @param {ReadonlySet<string>} covered
 * @param {ReadonlySet<string>} workspaceNames
 * @returns {string[]}
 */
function uncoveredProblems(pkg, root, covered, workspaceNames) {
  return uncoveredInDist(join(root, pkg.dir, "dist"), covered, workspaceNames).map(
    (item) =>
      `${pkg.dir}/dist bundles ${item}, which the notices do not cover; add it to the sources, ` +
      "BUNDLES_DEPENDENCIES, PAGES_APPS or EMBEDDED_PACKAGES, or stop bundling it",
  );
}

/**
 * Writes the LICENSE.md files of apps into the folders holding their builds.
 * @param {string} root
 * @param {readonly LicenseFile[]} files from pagesLicenseFiles or appLicenseFile
 * @param {ReadonlySet<string>} workspaceNames
 * @returns {string[]} problems
 */
function writeAppLicenseFiles(root, files, workspaceNames) {
  /** @type {string[]} */
  const problems = [];
  /** @param {string} path */
  const shown = (path) => (relative(root, path).startsWith("..") ? path : relative(root, path) || ".");
  for (const { pkg, path, contents, covered } of files) {
    if (!existsSync(dirname(path))) {
      problems.push(`${shown(dirname(path))} does not exist; build ${pkg.dir} and copy its output there first`);
      continue;
    }
    problems.push(...uncoveredProblems(pkg, root, covered, workspaceNames));
    if (contents === null) throw new Error(`${pkg.dir}: an app's ${LICENSE_FILE} is never empty`);
    writeFileSync(path, contents);
    console.log(`third-party-notices: wrote ${shown(path)} (${covered.size} third-party packages)`);
  }
  return problems;
}

/**
 * Deletes the generated LICENSE.md of every workspace package; hand-written files stay.
 * @param {string} root
 * @returns {string[]} package directories cleaned
 */
export function cleanLicenseFiles(root) {
  /** @type {string[]} */
  const cleaned = [];
  for (const pkg of readWorkspacePackages(root)) {
    const path = join(root, pkg.dir, LICENSE_FILE);
    if (existsSync(path) && readFileSync(path, "utf8").startsWith(GENERATED_MARKER)) {
      rmSync(path);
      cleaned.push(pkg.dir);
    }
  }
  return cleaned;
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      check: { type: "boolean", default: false },
      clean: { type: "boolean", default: false },
      pages: { type: "string" },
      app: { type: "string" },
    },
    allowPositionals: true,
  });
  const modes = [values.check, values.clean, values.pages !== undefined, values.app !== undefined];
  if (modes.filter(Boolean).length > 1) throw new Error("--check, --clean, --pages and --app cannot be combined");
  if (positionals.length !== (values.app === undefined ? 0 : 1)) {
    throw new Error(
      "usage: node scripts/release/third-party-notices.mjs [--check | --clean | --pages <dir> | --app <name> <dir>]",
    );
  }
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const workspaceNames = new Set(readWorkspacePackages(root).map((pkg) => String(pkg.manifest.name)));
  if (values.pages !== undefined || values.app !== undefined) {
    if (values.pages === "") throw new Error("--pages needs the folder of the assembled Pages artifact");
    const files =
      values.app === undefined
        ? pagesLicenseFiles(root, String(values.pages))
        : [appLicenseFile(root, values.app, resolve(positionals[0]))];
    const problems = writeAppLicenseFiles(root, files, workspaceNames);
    for (const problem of problems) console.error(`error: ${problem}`);
    return problems.length > 0 ? 1 : 0;
  }
  if (values.clean) {
    const cleaned = cleanLicenseFiles(root);
    console.log(`third-party-notices: removed ${LICENSE_FILE} from ${cleaned.join(", ") || "no package"}`);
    return 0;
  }
  const expected = expectedLicenseFiles(root);
  /** @type {string[]} */
  const problems = [];
  for (const { pkg, path, contents, covered } of expected) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current !== null && !current.startsWith(GENERATED_MARKER)) {
      problems.push(`${pkg.dir}/${LICENSE_FILE} exists but was not generated; remove or rename it`);
      continue;
    }
    problems.push(...uncoveredProblems(pkg, root, covered, workspaceNames));
    if (values.check) {
      // Missing files are expected: they are written right before packing. A leftover one must be current.
      if (current !== null && current !== contents) {
        problems.push(
          `${pkg.dir}/${LICENSE_FILE} is ${contents === null ? "no longer needed" : "stale"}; ` +
            "run `node scripts/release/third-party-notices.mjs --clean`",
        );
      }
    } else if (contents === null) {
      if (current !== null) rmSync(path);
    } else if (current !== contents) {
      writeFileSync(path, contents);
      console.log(`third-party-notices: wrote ${pkg.dir}/${LICENSE_FILE} (${covered.size} packages)`);
    }
  }
  for (const problem of problems) console.error(`error: ${problem}`);
  const withNotices = expected.filter((item) => item.contents !== null).map((item) => item.pkg.dir);
  console.log(
    `third-party-notices: ${withNotices.length} package(s) bundle third-party code: ${withNotices.join(", ") || "none"}`,
  );
  return problems.length > 0 ? 1 : 0;
}

runIfMain(import.meta.url, "third-party-notices", main);
