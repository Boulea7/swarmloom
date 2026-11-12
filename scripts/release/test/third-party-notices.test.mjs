// @ts-check
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bundledPackagesInOutput,
  GENERATED_MARKER,
  readmeLicenseSection,
  runtimeImports,
  synthesizedMitLicense,
} from "../lib/notices.mjs";
import { appLicenseFile, expectedLicenseFiles, pagesLicenseFiles } from "../third-party-notices.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("runtimeImports keeps value imports and flags inlined assets", () => {
  const source = [
    'import type { Root } from "mdast";',
    'export type { Options } from "remark-parse";',
    'import { unified, type Plugin } from "unified";',
    'import css from "katex/dist/katex.min.css?raw";',
    'const font = () => import("katex/dist/fonts/KaTeX_Main-Regular.woff2?inline");',
    'export { parse } from "@scope/pkg/sub";',
    'import "side-effect";',
    'import { local } from "./local";',
    'import { readFile } from "node:fs";',
    '@import url("highlight.js/styles/github.css");',
  ].join("\n");
  assert.deepEqual(runtimeImports(source), [
    { name: "@scope/pkg", asset: false },
    { name: "highlight.js", asset: false },
    { name: "katex", asset: true },
    { name: "side-effect", asset: false },
    { name: "unified", asset: false },
  ]);
});

test("bundle provenance and licence fallbacks", () => {
  const output = [
    "// ../../node_modules/.pnpm/katex@0.19.1/node_modules/katex/dist/katex.mjs",
    '{"sources":["../../../node_modules/.pnpm/three@0.187.0/node_modules/three/build/three.module.js",',
    '"../../../node_modules/.pnpm/@scope+x@1.0.0/node_modules/@scope/x/index.js","../src/index.ts"]}',
  ].join("\n");
  assert.deepEqual(bundledPackagesInOutput(output), ["@scope/x", "katex", "three"]);

  const readme = "# isarray\n\n## License\n\n(MIT)\n\nCopyright (c) 2013 Julian Gruber\n\n## Other\n";
  assert.equal(readmeLicenseSection(readme), "(MIT)\n\nCopyright (c) 2013 Julian Gruber");
  assert.equal(readmeLicenseSection("## License\n\nSee the website.\n"), null);

  const remark = "## License\n\n[MIT][license] © [Junyoung Choi][author]\n";
  assert.match(synthesizedMitLicense({ license: "MIT" }, remark) ?? "", /Copyright \(c\) Junyoung Choi\n/);
  assert.equal(synthesizedMitLicense({ license: "ISC", author: "A" }, ""), null);
  assert.equal(synthesizedMitLicense({ license: "MIT" }, "no holder"), null);
});

test("every published package that bundles third-party code gets generated notices", () => {
  const expected = expectedLicenseFiles(root);
  const byDir = new Map(expected.map((item) => [item.pkg.dir, item]));
  // The packages from the original report: Three in the CLI and the element, KaTeX in all three.
  assert.ok(byDir.get("apps/cli")?.covered.has("three"));
  assert.ok(byDir.get("packages/element")?.covered.has("three"));
  for (const dir of ["apps/cli", "packages/element", "packages/adapter-markdown"]) {
    assert.ok(byDir.get(dir)?.covered.has("katex"), dir);
    assert.ok(byDir.get(dir)?.contents?.startsWith(GENERATED_MARKER), dir);
    // The math fonts katex ships (and the adapter inlines) are OFL-1.1, not under katex's MIT licence.
    assert.match(
      byDir.get(dir)?.contents ?? "",
      /Copyright \(c\) 2009-2010, Design Science[^`]*KaTeX_Typewriter\.\n\nThis Font Software is licensed under the SIL Open Font License, Version 1\.1\./,
      dir,
    );
  }
  // Three ships the Draco (Apache-2.0) and meshoptimizer (MIT) decoders in examples/jsm/libs, and Vite emits them.
  for (const dir of ["apps/cli", "packages/element", "packages/export"]) {
    const contents = byDir.get(dir)?.contents ?? "";
    assert.match(contents, /Copyright 2016 The Draco Authors\n\n\s*Apache License\s+Version 2\.0/, dir);
    assert.match(contents, /Copyright \(c\) 2016-2026 Arseny Kapoulkine/, dir);
  }
  // A library that bundles nothing gets no file and keeps the repository LICENSE from pnpm pack.
  assert.equal(byDir.get("packages/core")?.contents, null);
  // Generated at pack time only: a committed copy would go stale with every dependency update.
  const paths = expected.map((item) => `${item.pkg.dir}/LICENSE.md`);
  const tracked = execFileSync("git", ["ls-files", "--", ...paths], { cwd: root, encoding: "utf8" });
  assert.equal(tracked.trim(), "", "generated LICENSE.md files must not be committed");
});

test("every app deployed to Pages gets the licences of what it bundles or inlines", () => {
  const byDir = new Map(pagesLicenseFiles(root, "_site").map((item) => [item.pkg.dir, item]));
  // The report: the site inlines Phosphor SVG paths (read from disk, not imported); Studio bundles lottie-web.
  assert.match(byDir.get("apps/site")?.contents ?? "", /Copyright \(c\) \d{4} Phosphor Icons/);
  assert.equal(byDir.get("apps/site")?.path, join(root, "_site", "LICENSE.md"));
  assert.match(byDir.get("apps/studio")?.contents ?? "", /Copyright \(c\) 2015 Bodymovin/);
  assert.equal(byDir.get("apps/studio")?.path, join(root, "_site", "studio", "LICENSE.md"));
  // The docs are no workspace package: VitePress emits Vue, its theme's Inter font and MiniSearch/mark.js search.
  const docs = byDir.get("docs");
  assert.equal(docs?.path, join(root, "_site", "docs", "LICENSE.md"));
  for (const name of ["vitepress", "@vue/runtime-core", "minisearch", "mark.js", "focus-trap", "Inter"]) {
    assert.ok(docs?.covered.has(name), name);
  }
  const inter = /Copyright 2016 The Inter Project Authors[^\n]*\n\n[\s\S]{0,300}SIL OPEN FONT LICENSE Version 1\.1/;
  assert.match(docs?.contents ?? "", inter);
  const workflow = readFileSync(join(root, ".github/workflows/pages.yml"), "utf8");
  assert.match(workflow, /third-party-notices\.mjs --pages _site\b/);
});

test("the bookmarklet's Pages folder and Release ZIP carry SwarmLoom's licence", () => {
  // The report: it bundles no third-party code, so neither got a LICENSE.md and the ZIP had no licence at all.
  const license = readFileSync(join(root, "LICENSE"), "utf8").trim();
  const pages = pagesLicenseFiles(root, "_site").find((item) => item.pkg.dir === "apps/bookmarklet");
  assert.ok(pages?.contents?.includes(license));
  const zip = appLicenseFile(root, "@swarmloom/bookmarklet", "apps/bookmarklet/dist");
  assert.equal(zip.path, join(root, "apps/bookmarklet/dist/LICENSE.md"));
  assert.equal(zip.contents, pages?.contents);
  const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  const packed =
    /--app @swarmloom\/bookmarklet apps\/bookmarklet\/dist\n\s*node scripts\/release\/pack-folder\.mjs apps\/bookmarklet\/dist /;
  assert.match(workflow, packed);
});
