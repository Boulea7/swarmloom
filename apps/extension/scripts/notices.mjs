// Third-party licence notices for the extension packages (THIRD_PARTY_NOTICES.txt).
//
// Two sources feed the list: the node_modules files esbuild bundled into the extension's own
// scripts (exact, from the metafile), and, when the Studio build is copied in, the production
// dependency closure of @swarmloom/studio (Vite bundles from those packages). Workspace packages
// are SwarmLoom's own code, covered by its MIT licence (LICENSE.txt in the package).
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** File names the packages carry: the third-party notices and SwarmLoom's own licence. */
export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";
export const LICENSE_COPY = "LICENSE.txt";

/** Top-level files that carry a package's licence or NOTICE text (LICENSE, LICENSE-MPL, COPYING.txt ...). */
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[-._][\w.-]*)?$/i;

/** Standard MIT text, used when a package declares MIT in package.json but ships no licence file. */
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const RULE = "=".repeat(80);

/**
 * @typedef {object} EmbeddedPackage
 * @property {string} name
 * @property {string} host installed package whose files contain this one, pre-bundled
 * @property {string} file file of the host holding `record`
 * @property {"utf8" | "utf-16be"} [encoding] how `file` stores `record` (default utf8; a font's name table is UTF-16BE)
 * @property {RegExp} record must match in `file`; its `version` and `copyright` groups, when it has them,
 *   give the embedded code's version (else "as shipped in <host> <version>") and copyright line (else `copyright`)
 * @property {string} [copyright] the copyright notice when `record` captures none
 * @property {string} marker string every bundled copy carries, minified or not (audit.mjs looks for it)
 * @property {keyof typeof LICENSE_TERMS} license
 * @property {string} source
 */

// Resolved as a path: under Vitest's DOM environment the global URL resolves relative to the page.
const LICENSES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/release/licenses");

/**
 * Licence terms of embedded packages: the standard MIT text, or a full text in LICENSES_DIR shared with
 * the npm notices (amo-source.mjs ships those files).
 */
const LICENSE_TERMS = {
  MIT: { label: "standard MIT text", file: "" },
  "Apache-2.0": { label: "Apache License 2.0", file: "Apache-2.0.txt" },
  "OFL-1.1": { label: "SIL Open Font License 1.1", file: "OFL-1.1.txt" },
};

/**
 * Code and assets that a dependency ships pre-bundled inside its own files under their own licence or
 * copyright, so they have no package or licence file to read. Listed whenever their host is bundled. Keep
 * in step with EMBEDDED_PACKAGES in scripts/release/third-party-notices.mjs (the npm package notices).
 * @type {readonly EmbeddedPackage[]}
 */
export const EMBEDDED_PACKAGES = [
  {
    name: "core-js",
    host: "pdfjs-dist",
    // core-js records itself in its shared store: { version, mode, copyright, license, source }.
    file: "legacy/build/pdf.mjs",
    record: /\bversion:\s*["'](?<version>[^"']+)["'],\s*mode:[^,]+,\s*copyright:\s*["'](?<copyright>[^"']+)["']/,
    marker: "__core-js_shared__",
    license: "MIT",
    source: "https://github.com/zloirock/core-js",
  },
  {
    name: "draco3d",
    host: "three",
    // DRACOLoader's decoders (draco/ and draco/gltf/: WASM, its wrapper and an asm.js build), which Vite
    // emits as they are. They record neither version nor copyright; the line is that of the Draco sources.
    file: "examples/jsm/libs/draco/draco_wasm_wrapper.js",
    record: /\bDracoDecoderModule\b/,
    copyright: "Copyright 2016 The Draco Authors",
    marker: "DracoDecoderModule",
    license: "Apache-2.0",
    source: "https://github.com/google/draco",
  },
  {
    name: "meshoptimizer",
    host: "three",
    // GLTFLoader's EXT_meshopt_compression decoder; its header comment states the copyright and version.
    file: "examples/jsm/libs/meshopt_decoder.module.js",
    record: /\/\/ (?<copyright>Copyright \(C\) [^\n]+)[\s\S]*?\bBuilt from meshoptimizer (?<version>\d[\w.-]*)/,
    marker: "decodeVertexBuffer", // a method of the decoder object, so minification keeps it
    license: "MIT",
    source: "https://github.com/zeux/meshoptimizer",
  },
  {
    name: "KaTeX fonts",
    host: "katex",
    // The Studio's Markdown adapter inlines the dist/fonts WOFF2 files (Brotli-compressed); the TTF next to
    // each carries the same name table, whose description (name ID 13) states the copyright and licence.
    file: "dist/fonts/KaTeX_Main-Regular.ttf",
    encoding: "utf-16be",
    record: /\bThis Font Software is licensed under the SIL Open Font License, Version 1\.1\./,
    copyright:
      "Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)\n" +
      "Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>),\n" +
      "with Reserved Font Names KaTeX_AMS, KaTeX_Caligraphic, KaTeX_Fraktur, KaTeX_Main, KaTeX_Math, " +
      "KaTeX_SansSerif, KaTeX_Script, KaTeX_Size1, KaTeX_Size2, KaTeX_Size3, KaTeX_Size4, KaTeX_Typewriter.",
    marker: "KaTeX_Main",
    license: "OFL-1.1",
    source: "https://github.com/KaTeX/katex-fonts",
  },
];

/**
 * Notices of the packages `host` ships pre-bundled, with the version and copyright line read from it.
 * @param {string} dir real path of the host package
 * @param {any} pkg the host's package.json
 * @returns {Notice[]}
 * @throws Error when the host file no longer holds the record (update EMBEDDED_PACKAGES)
 */
function embeddedNotices(dir, pkg) {
  return EMBEDDED_PACKAGES.filter((embedded) => embedded.host === pkg.name).map((embedded) => {
    const path = join(dir, embedded.file);
    const found = existsSync(path)
      ? new TextDecoder(embedded.encoding ?? "utf8").decode(readFileSync(path)).match(embedded.record)
      : null;
    const copyright = found?.groups?.copyright ?? embedded.copyright;
    if (!found || !copyright) {
      throw new Error(
        `${pkg.name}@${pkg.version}: no ${embedded.name} record in ${embedded.file}; update EMBEDDED_PACKAGES`,
      );
    }
    const terms = LICENSE_TERMS[embedded.license];
    // trimEnd: the Apache text centres its heading with leading spaces.
    const text = terms.file ? readFileSync(join(LICENSES_DIR, terms.file), "utf8").trimEnd() : MIT_TEXT;
    const file = `(${terms.label}; pre-bundled inside ${pkg.name}, which ships no licence file for it)`;
    return {
      name: embedded.name,
      version: found.groups?.version ?? `as shipped in ${pkg.name} ${pkg.version}`,
      license: embedded.license,
      source: embedded.source,
      texts: [{ file, text: `${copyright}\n\n${text}` }],
    };
  });
}

/**
 * MPL-2.0 packages whose licence file carries no copyright line: they state it in the header comment of
 * every source file (MPL-2.0 Exhibit A), which the minified Studio build drops, so the notice repeats the
 * copyright lines of the named file's header. A bundled MPL-2.0 package must be listed here unless its
 * licence file names the holder. Keep in step with HEADER_COPYRIGHTS in scripts/release/third-party-notices.mjs.
 * @type {ReadonlyMap<string, string>} package name -> file of the package whose header holds the copyright
 */
export const HEADER_COPYRIGHTS = new Map([
  ["dompurify", "dist/purify.es.mjs"],
  ["mediabunny", "dist/modules/src/index.js"],
]);

/**
 * The copyright notice a package keeps in its source file headers (see HEADER_COPYRIGHTS), or null when
 * it needs none.
 * @param {string} dir real path of the package
 * @param {any} pkg its package.json
 * @param {string} license
 * @param {readonly { text: string }[]} texts its licence files
 * @returns {{ file: string; text: string } | null}
 * @throws Error when the listed file holds no copyright line, or an unlisted MPL-2.0 package names no holder
 */
function headerNotice(dir, pkg, license, texts) {
  const file = HEADER_COPYRIGHTS.get(pkg.name);
  if (file === undefined) {
    // Neither the MPL-2.0 nor the Apache-2.0 text holds a copyright line of its own (beyond Apache's template).
    const holder = /^\W*(?:Copyright\b(?! \[yyyy\])|\(c\)\s*\d|©)/m;
    if (/\bMPL-2\.0\b/.test(license) && !texts.some(({ text }) => holder.test(text))) {
      throw new Error(`${pkg.name}@${pkg.version}: MPL-2.0 without a copyright line; add it to HEADER_COPYRIGHTS`);
    }
    return null;
  }
  const path = join(dir, file);
  const comment = existsSync(path) ? (/^\s*\/\*[\s\S]*?\*\//.exec(readFileSync(path, "utf8"))?.[0] ?? "") : "";
  const lines = [...comment.matchAll(/(?:\bCopyright\b|\(c\)|©)[^\n|*]*/g)].map((match) => match[0].trim());
  if (lines.length === 0) {
    throw new Error(`${pkg.name}@${pkg.version}: no copyright line in the header of ${file}; update HEADER_COPYRIGHTS`);
  }
  return { file: `(copyright from the header of ${file}, which bundling drops)`, text: [...new Set(lines)].join("\n") };
}

/**
 * @typedef {object} Notice
 * @property {string} name
 * @property {string} version
 * @property {string} license SPDX expression from package.json
 * @property {string} source homepage or repository URL, "" when unknown
 * @property {{ file: string; text: string }[]} texts licence files, or the standard MIT text
 */

/** @param {string} path @returns {any} */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Root folder of the installed package a bundled file belongs to, or null when the file is not
 * inside node_modules (workspace sources, virtual modules).
 * @param {string} file absolute path
 * @returns {string | null}
 */
export function packageRootOf(file) {
  const parts = file.split(/[\\/]/);
  const at = parts.lastIndexOf("node_modules");
  const name = parts[at + 1];
  if (at < 0 || !name) return null;
  const end = at + (name.startsWith("@") ? 3 : 2);
  return end <= parts.length - 1 ? parts.slice(0, end).join(sep) : null;
}

/**
 * Package roots of the third-party inputs listed in esbuild metafiles.
 * @param {readonly { inputs: Record<string, unknown> }[]} metafiles
 * @param {string} workingDir the build's absWorkingDir (input paths are relative to it)
 * @returns {string[]}
 */
export function bundledPackages(metafiles, workingDir) {
  /** @type {Set<string>} */
  const roots = new Set();
  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile.inputs)) {
      // Plugin namespaces ("swarmloom-no-adapter:...") never point at files.
      if (/^[\w-]+:/.test(input) && !/^[a-z]:[\\/]/i.test(input)) continue;
      const root = packageRootOf(resolve(workingDir, input));
      if (root) roots.add(root);
    }
  }
  return [...roots];
}

/**
 * Finds an installed dependency the way Node does: `node_modules/<name>` in `from` or an ancestor.
 * @param {string} name
 * @param {string} from
 * @returns {string | null} real path of the package folder
 */
function resolvePackage(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Runtime dependency closure of a package: `dependencies` plus installed `optionalDependencies`,
 * transitively. Type-only packages (`@types/*`) and platform binaries (packages with `os` or `cpu`
 * constraints, which differ per machine and never run in a browser) are left out.
 * @param {string} start package folder
 * @returns {string[]} real paths, start included
 * @throws Error when a required dependency is not installed
 */
export function dependencyClosure(start) {
  /** @type {Set<string>} */
  const seen = new Set();
  const queue = [realpathSync(start)];
  while (queue.length > 0) {
    const dir = /** @type {string} */ (queue.pop());
    if (seen.has(dir)) continue;
    seen.add(dir);
    const pkg = readJson(join(dir, "package.json"));
    for (const [field, optional] of /** @type {const} */ ([
      ["dependencies", false],
      ["optionalDependencies", true],
    ])) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (name.startsWith("@types/")) continue;
        const found = resolvePackage(name, dir);
        if (!found) {
          if (optional) continue;
          throw new Error(`${pkg.name}: dependency ${name} is not installed`);
        }
        const dep = readJson(join(found, "package.json"));
        if (dep.os === undefined && dep.cpu === undefined) queue.push(found);
      }
    }
  }
  return [...seen];
}

/** @param {any} pkg @returns {string} */
function licenseOf(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  // Legacy `licenses: [{ type }]`: any of them may be chosen.
  const legacy = Array.isArray(pkg.licenses) ? pkg.licenses.map((/** @type {any} */ l) => l?.type ?? l) : [];
  return legacy.filter((/** @type {unknown} */ l) => typeof l === "string").join(" OR ");
}

/** @param {any} pkg @returns {string} */
function sourceOf(pkg) {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const url = typeof pkg.homepage === "string" ? pkg.homepage : repo;
  return typeof url === "string" ? url.replace(/^git\+/, "") : "";
}

/** @param {any} pkg @returns {string} */
function authorOf(pkg) {
  const author = pkg.author;
  if (typeof author === "string") return author;
  return typeof author?.name === "string" ? author.name : "";
}

/**
 * Reads the notice of every third-party package among `roots` (folders inside node_modules), and of
 * the packages they ship pre-bundled; workspace packages are skipped. Sorted by name and version, one
 * entry per name@version.
 * @param {Iterable<string>} roots
 * @returns {Notice[]}
 * @throws Error when a package ships no licence file and is not MIT (no text to reproduce), or a
 *   host of EMBEDDED_PACKAGES no longer holds the embedded package's record
 */
export function collectNotices(roots) {
  /** @type {Map<string, Notice>} */
  const byId = new Map();
  for (const root of roots) {
    const dir = realpathSync(root);
    if (!dir.split(sep).includes("node_modules")) continue;
    const pkg = readJson(join(dir, "package.json"));
    const id = `${pkg.name}@${pkg.version}`;
    if (byId.has(id)) continue;
    const license = licenseOf(pkg);
    const texts = readdirSync(dir)
      .filter((file) => LICENSE_FILE.test(file) && statSync(join(dir, file)).isFile())
      .sort()
      .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n").trim() }));
    if (texts.length === 0) {
      if (license !== "MIT") {
        throw new Error(`${id}: no licence file in the package and no standard text for "${license}"`);
      }
      const author = authorOf(pkg);
      const copyright = author ? `Copyright (c) ${author}\n\n` : "";
      texts.push({ file: "(standard MIT text; the package ships no licence file)", text: `${copyright}${MIT_TEXT}` });
    }
    const header = headerNotice(dir, pkg, license, texts);
    if (header) texts.unshift(header);
    byId.set(id, { name: pkg.name, version: pkg.version, license, source: sourceOf(pkg), texts });
    for (const notice of embeddedNotices(dir, pkg)) {
      const embeddedId = `${notice.name}@${notice.version}`;
      if (!byId.has(embeddedId)) byId.set(embeddedId, notice);
    }
  }
  // Code-unit order, not localeCompare: the file must not depend on the ICU data of the machine.
  return [...byId.keys()].sort().map((id) => /** @type {Notice} */ (byId.get(id)));
}

/**
 * Renders THIRD_PARTY_NOTICES.txt. A licence text that already appeared (the Apache-2.0 text
 * shipped by several packages, for example) is referenced instead of repeated.
 * @param {readonly Notice[]} notices
 * @returns {string}
 */
export function renderNotices(notices) {
  const lines = [
    "SwarmLoom browser extension: third-party notices",
    "",
    notices.length > 0
      ? "This package includes the third-party software listed below, each under its own licence."
      : "This package includes no third-party software.",
    `SwarmLoom itself is released under the MIT License (${LICENSE_COPY}).`,
  ];
  /** @type {Map<string, string>} */
  const firstSeen = new Map();
  for (const notice of notices) {
    const id = `${notice.name} ${notice.version}`;
    lines.push("", RULE, id, `License: ${notice.license || "(not declared)"}`);
    if (notice.source) lines.push(`Source: ${notice.source}`);
    for (const { file, text } of notice.texts) {
      const earlier = firstSeen.get(text);
      if (earlier) {
        lines.push("", `${file}: same text as ${earlier} above.`);
        continue;
      }
      firstSeen.set(text, id);
      lines.push("", `--- ${file} ---`, "", text);
    }
  }
  return `${lines.join("\n")}\n`;
}
