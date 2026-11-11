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
 * Modes (each fails when a bundled package ships no licence text, when a hand-written LICENSE.md is in
 * the way, or when a built dist/ holds a module path, from an esbuild comment or a source map, of a
 * package the notices do not cover):
 * - default: write the LICENSE.md files (and delete generated ones no longer needed);
 * - `--check`: write nothing; also fails when a generated LICENSE.md on disk is stale;
 * - `--clean`: delete the generated LICENSE.md files after a local release;
 * - `--pages <dir>`: write a LICENSE.md into each app folder of the assembled GitHub Pages artifact
 *   instead (PAGES_APPS); the npm packages are left alone.
 *
 * Usage: node scripts/release/third-party-notices.mjs [--check | --clean | --pages <dir>]
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
 * @property {string} path folder of the Pages artifact the app's dist/ is copied to ("" for the root)
 * @property {WholeTreeBuild} build
 */

/**
 * Private apps deployed to GitHub Pages (.github/workflows/pages.yml). They are Vite or esbuild app
 * builds, so each bundles its whole runtime tree; their LICENSE.md lands next to the app's index.html.
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
]);

/**
 * @typedef {object} EmbeddedPackage
 * @property {string} host installed package whose files contain this one, pre-bundled
 * @property {string} license
 * @property {string} source
 * @property {string} copyright the copyright line the embedded code carries
 */

/**
 * MIT packages that a dependency ships pre-bundled inside its own files, so they are never installed and
 * have no licence file to read. Listed whenever their host is bundled.
 * @type {ReadonlyMap<string, EmbeddedPackage>}
 */
export const EMBEDDED_PACKAGES = new Map([
  [
    "core-js",
    {
      host: "pdfjs-dist", // legacy/build/*.mjs; the copyright string is in the core-js shared-store code
      license: "MIT",
      source: "https://github.com/zloirock/core-js",
      copyright: "2013–2025 Denis Pushkarev (zloirock.ru), 2025–2026 CoreJS Company (core-js.io)",
    },
  ],
]);

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
   */
  const addThirdParty = (fromDir, name, withDependencies) => {
    if (name.startsWith("@types/")) return; // declarations only, nothing reaches a bundle
    const dir = resolvePackage(fromDir, name);
    if (!dir) throw new Error(`${name} is not installed (needed from ${relative(root, fromDir) || "."})`);
    found.set(dir, name);
    if (!withDependencies || expanded.has(dir)) return;
    expanded.add(dir);
    const manifest = readJson(join(dir, "package.json"));
    if (!isRecord(manifest)) throw new Error(`${dir}/package.json is not a JSON object`);
    // Optional dependencies of npm packages are native or platform add-ons that bundlers cannot inline.
    for (const dep of dependencyNames(manifest, ["dependencies"])) {
      addThirdParty(dir, dep, true);
    }
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
  const text = texts.join("\n\n");
  return { name: manifest.name, license: licenseOf(manifest), source: repositoryUrl(manifest), text };
}

/**
 * @typedef {object} LicenseFile
 * @property {WorkspacePackage} pkg
 * @property {string} path where the LICENSE.md goes
 * @property {string | null} contents null when the package bundles no third-party code
 * @property {Set<string>} covered names of the packages the file covers
 */

/**
 * LICENSE.md of one workspace package: the repository licence, then every bundled third-party package.
 * @param {WorkspacePackage} pkg
 * @param {ReadonlyMap<string, WorkspacePackage>} workspace by package name
 * @param {string} root repository root
 * @param {string} path where the file goes
 * @param {WholeTreeBuild} [wholeTree] see bundledPackages
 * @returns {LicenseFile}
 */
function licenseFile(pkg, workspace, root, path, wholeTree) {
  /** @type {Map<string, NoticeEntry>} */
  const entries = new Map();
  for (const dir of bundledPackages(pkg, workspace, root, wholeTree).keys()) {
    const entry = noticeEntry(dir);
    entries.set(`${entry.name}\n${entry.text}`, entry);
    for (const [name, embedded] of EMBEDDED_PACKAGES) {
      if (embedded.host !== entry.name) continue;
      const note = `Pre-bundled inside ${embedded.host}, which ships no separate licence file for it.`;
      const text = mitLicense(embedded.copyright, note);
      entries.set(`${name}\n${text}`, { name, license: embedded.license, source: embedded.source, text });
    }
  }
  const list = [...entries.values()];
  const ownLicense = readFileSync(join(root, "LICENSE"), "utf8");
  return {
    pkg,
    path,
    contents: list.length ? renderLicenseFile(String(pkg.manifest.name), ownLicense, list) : null,
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
 * LICENSE.md of every app in PAGES_APPS, placed in the app's folder of the Pages artifact.
 * @param {string} root
 * @param {string} siteDir the assembled artifact, absolute or relative to `root`
 * @returns {LicenseFile[]}
 */
export function pagesLicenseFiles(root, siteDir) {
  const { workspace } = workspaceByName(root);
  return [...PAGES_APPS].map(([name, app]) => {
    const pkg = workspace.get(name);
    if (!pkg) throw new Error(`${name} (PAGES_APPS) is not a workspace package`);
    return licenseFile(pkg, workspace, root, resolve(root, siteDir, app.path, LICENSE_FILE), app.build);
  });
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
 * Writes the LICENSE.md of every PAGES_APPS app into the assembled Pages artifact.
 * @param {string} root
 * @param {string} siteDir
 * @param {ReadonlySet<string>} workspaceNames
 * @returns {string[]} problems
 */
function writePagesLicenseFiles(root, siteDir, workspaceNames) {
  /** @type {string[]} */
  const problems = [];
  /** @param {string} path */
  const shown = (path) => (relative(root, path).startsWith("..") ? path : relative(root, path) || ".");
  for (const { pkg, path, contents, covered } of pagesLicenseFiles(root, siteDir)) {
    if (!existsSync(dirname(path))) {
      problems.push(`${shown(dirname(path))} does not exist; copy ${pkg.dir}/dist into the Pages artifact first`);
      continue;
    }
    problems.push(...uncoveredProblems(pkg, root, covered, workspaceNames));
    if (contents === null) {
      console.log(`third-party-notices: ${pkg.dir} bundles no third-party code, no ${LICENSE_FILE} needed`);
      continue;
    }
    writeFileSync(path, contents);
    console.log(`third-party-notices: wrote ${shown(path)} (${covered.size} packages)`);
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
  const { values } = parseArgs({
    options: {
      check: { type: "boolean", default: false },
      clean: { type: "boolean", default: false },
      pages: { type: "string" },
    },
  });
  if ([values.check, values.clean, values.pages !== undefined].filter(Boolean).length > 1) {
    throw new Error("--check, --clean and --pages cannot be combined");
  }
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const workspaceNames = new Set(readWorkspacePackages(root).map((pkg) => String(pkg.manifest.name)));
  if (values.pages !== undefined) {
    if (!values.pages) throw new Error("--pages needs the folder of the assembled Pages artifact");
    const problems = writePagesLicenseFiles(root, values.pages, workspaceNames);
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
