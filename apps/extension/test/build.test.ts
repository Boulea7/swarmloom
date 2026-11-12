import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { addTree, spawnCommand } from "../scripts/amo-source.mjs";
import { auditPackage } from "../scripts/audit.mjs";
import { placeholderIcon } from "../scripts/icons.mjs";
import { cspProblems, GECKO_ID, manifestFor, messageKeys, validateManifest } from "../scripts/manifest.mjs";
import {
  bundledPackages,
  collectNotices,
  dependencyClosure,
  LICENSE_COPY,
  NOTICES_FILE,
  renderNotices,
} from "../scripts/notices.mjs";
import { copyStudio } from "../scripts/studio.mjs";
import { parseTargets, TARGET_IDS } from "../scripts/targets.mjs";
import { directoryEntries, sourceDateEpoch, unzipEntries, zipEntries } from "../scripts/zip.mjs";
import { BUILD_CAPABILITIES } from "../src/shared/capabilities";
import { catalogFor, LOCALES } from "../src/shared/i18n";

// biome-ignore lint/suspicious/noExplicitAny: generated manifests are plain JSON probed by the assertions.
type Json = Record<string, any>;

describe("manifests", () => {
  it("generates a valid manifest for every target", () => {
    for (const target of TARGET_IDS) {
      const m = manifestFor(target, "1.2.3") as Json;
      expect(validateManifest(m, target), target).toEqual([]);
      expect(m.action?.default_popup ?? m.browser_action?.default_popup).toBeUndefined();
      expect(m.host_permissions).toBeUndefined();
      expect(m.permissions.includes("contextMenus"), target).toBe(BUILD_CAPABILITIES[target].contextMenus);
    }
  });

  it("uses the right background and settings per browser", () => {
    const chrome = manifestFor("chrome", "1.0.0") as Json;
    expect(chrome.background).toEqual({ service_worker: "background.js" });
    expect(chrome.commands._execute_action.suggested_key.default).toBe("Alt+Shift+W");

    // One Firefox XPI for desktop and Android: MV2 event page with gecko and gecko_android.
    const firefox = manifestFor("firefox", "1.0.0") as Json;
    expect(firefox).toMatchObject({
      manifest_version: 2,
      background: { scripts: ["background.js"], persistent: false },
    });
    expect(firefox.browser_action).toBeDefined();
    expect(firefox.action).toBeUndefined();
    expect(firefox.commands._execute_browser_action.suggested_key.default).toBe("Alt+Shift+W");
    expect(firefox.optional_permissions).toEqual(["<all_urls>"]);
    expect(firefox.browser_specific_settings).toEqual({
      gecko: { id: GECKO_ID, strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } },
      gecko_android: { strict_min_version: "142.0" },
    });

    // The MV3 variant stays generatable for later, but only as an internal option.
    const firefoxMv3 = manifestFor("firefox", "1.0.0", { manifestVersion: 3 }) as Json;
    expect(validateManifest(firefoxMv3, "firefox", { manifestVersion: 3 })).toEqual([]);
    expect(firefoxMv3).toMatchObject({ manifest_version: 3, background: { persistent: false } });
    expect(() => manifestFor("chrome", "1.0.0", { manifestVersion: 2 })).toThrow();

    const safari = manifestFor("safari", "1.0.0") as Json;
    expect(safari.background).toEqual({ service_worker: "background.js" });
    expect(safari.permissions).toEqual(["activeTab", "scripting", "storage", "contextMenus"]);

    // Bundled Studio decodes Draco and PDFs with WebAssembly; MV3's default CSP blocks it.
    const wasmCsp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";
    for (const m of [chrome, safari]) expect(m.content_security_policy).toEqual({ extension_pages: wasmCsp });
    expect(firefox.content_security_policy).toBe(wasmCsp);
  });

  it("rejects broken manifests and unknown targets", () => {
    const bad: Json = {
      ...(manifestFor("chrome", "1.0.0") as Json),
      host_permissions: ["<all_urls>"],
      version: "01.2",
    };
    bad.action = { default_popup: "popup.html" };
    const problems = validateManifest(bad, "chrome").join("\n");
    expect(problems).toMatch(/host_permissions/);
    expect(problems).toMatch(/popup/);
    expect(problems).toMatch(/version/);
    expect(validateManifest(manifestFor("firefox", "1.0.0"), "chrome")).not.toEqual([]);
    const remote = {
      ...(manifestFor("firefox", "1.0.0") as Json),
      content_security_policy: "script-src 'self' https://cdn.example; object-src 'self'",
    };
    expect(validateManifest(remote, "firefox").join("\n")).toMatch(/cdn\.example/);
    const { content_security_policy: _, ...noCsp } = manifestFor("chrome", "1.0.0") as Json;
    expect(validateManifest(noCsp, "chrome").join("\n")).toMatch(/extension_pages must allow 'wasm-unsafe-eval'/);
    expect(cspProblems("script-src 'self' 'unsafe-eval'")).toHaveLength(1);
    expect(parseTargets("all")).toEqual([...TARGET_IDS]);
    expect(() => parseTargets("chrome,netscape")).toThrow("netscape");
  });
});

describe("locales", () => {
  it("has every key in every language with matching placeholders and no '$'", () => {
    const en = catalogFor("en") as Record<string, string>;
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const manifestKeys = messageKeys(manifestFor("chrome", "1.0.0"));
    for (const locale of LOCALES) {
      const catalog = catalogFor(locale) as Record<string, string>;
      expect(Object.keys(catalog).sort(), locale).toEqual(Object.keys(en).sort());
      for (const [key, text] of Object.entries(catalog)) {
        expect(text.trim(), `${locale}.${key}`).not.toBe("");
        expect(vars(text), `${locale}.${key}`).toEqual(vars(en[key] ?? ""));
      }
      for (const key of manifestKeys) expect(catalog[key], `${locale}.${key}`).not.toContain("$");
      expect((catalog.extName ?? "").length).toBeLessThanOrEqual(45);
      expect((catalog.extDescription ?? "").length).toBeLessThanOrEqual(132);
    }
  });
});

describe("packaging helpers", () => {
  it("zips deterministically and round-trips", () => {
    const files = [
      { name: "manifest.json", data: new TextEncoder().encode('{"a":1}') },
      { name: "icons/icon-16.png", data: placeholderIcon(16) },
    ];
    const a = zipEntries(files);
    const b = zipEntries([...files].reverse());
    expect(a).toEqual(b);
    const back = unzipEntries(a);
    expect(back.map((e) => e.name)).toEqual(["icons/icon-16.png", "manifest.json"]);
    expect(new TextDecoder().decode(back[1]?.data)).toBe('{"a":1}');
    expect(() => zipEntries([{ name: "../evil", data: new Uint8Array() }])).toThrow();

    // SOURCE_DATE_EPOCH sets every entry's MS-DOS timestamp; invalid values are rejected.
    const stamped = zipEntries(files, { mtime: sourceDateEpoch("1700000000") });
    expect(stamped.readUInt16LE(12)).toBe(((2023 - 1980) << 9) | (11 << 5) | 14);
    expect(sourceDateEpoch(undefined)).toBeUndefined();
    expect(() => sourceDateEpoch("yesterday")).toThrow(/SOURCE_DATE_EPOCH/);
  });

  it("draws placeholder icons as valid PNGs of the requested size", async () => {
    const png: Uint8Array = placeholderIcon(32);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(new TextDecoder().decode(png.subarray(1, 4))).toBe("PNG");
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([32, 32]);
    // One IDAT chunk at offset 33 (signature 8 + IHDR 25): length, type, zlib data.
    expect(new TextDecoder().decode(png.subarray(37, 41))).toBe("IDAT");
    const zlib = png.slice(41, 41 + view.getUint32(33));
    const raw = await new Response(
      new Blob([zlib]).stream().pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer();
    expect(raw.byteLength).toBe(32 * (1 + 32 * 4));
  });

  it("keeps Studio's build/ Vite plugins in the AMO source package, not outputs or tests", () => {
    const repo = mkdtempSync(join(tmpdir(), "swarmloom-amo-tree-"));
    try {
      for (const file of [
        "apps/extension/src/background.ts",
        "apps/extension/build/safari/SwarmLoom.xcodeproj/project.pbxproj",
        "apps/studio/vite.config.ts",
        "apps/studio/build/pwa.ts",
        "apps/studio/dist-extension/studio.html",
        "apps/studio/test/pwa.test.ts",
      ]) {
        mkdirSync(dirname(join(repo, file)), { recursive: true });
        writeFileSync(join(repo, file), "");
      }
      const files = new Map<string, Buffer>();
      addTree(join(repo, "apps"), files, repo);
      expect([...files.keys()].sort()).toEqual([
        "apps/extension/src/background.ts",
        "apps/studio/build/pwa.ts",
        "apps/studio/vite.config.ts",
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("starts pnpm through the shell on Windows for --verify (Corepack installs pnpm.cmd)", () => {
    const args = ["-F", "@swarmloom/extension", "exec", "node", "scripts/build.mjs", "--target", "firefox"];
    expect(spawnCommand("pnpm", args, "linux")).toEqual({ file: "pnpm", args, shell: false });
    expect(spawnCommand("pnpm", args, "win32")).toEqual({
      file: "pnpm -F @swarmloom/extension exec node scripts/build.mjs --target firefox",
      args: [],
      shell: true,
    });
    expect(() => spawnCommand("pnpm", ["C:\\Temp Dir\\x & y"], "win32")).toThrow(/Windows shell/);
  });
});

describe("bundled Studio", () => {
  it("is built before the extension and refuses a copy taken while the Studio is being rebuilt", () => {
    // pnpm -r orders builds by workspace dependencies; without this one the root build runs both at once.
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(pkg.devDependencies["@swarmloom/studio"]).toBe("workspace:*");

    const dir = mkdtempSync(join(tmpdir(), "swarmloom-studio-test-"));
    try {
      const studio = { dir: join(dir, "src"), entry: "studio.html" };
      mkdirSync(join(studio.dir, "assets"), { recursive: true });
      writeFileSync(
        join(studio.dir, "studio.html"),
        '<!-- src="./gone.js" --><script type="module" src="./assets/index.js"></script>' +
          '<link rel="stylesheet" href="./assets/index.css?v=1"><link rel="icon" href="https://example.com/x.svg">',
      );
      writeFileSync(join(studio.dir, "assets", "index.js"), "");
      writeFileSync(join(studio.dir, "assets", "index.css"), "");
      copyStudio(studio, join(dir, "whole"));
      expect(existsSync(join(dir, "whole", "assets", "index.css"))).toBe(true);

      // Vite empties the folder first: the page may still be there while its chunks are not, or the reverse.
      rmSync(join(studio.dir, "assets", "index.css"));
      expect(() => copyStudio(studio, join(dir, "half"))).toThrow(
        /incomplete \(studio\.html links missing assets\/index\.css\)/,
      );
      rmSync(join(studio.dir, "studio.html"));
      expect(() => copyStudio(studio, join(dir, "empty"))).toThrow(/incomplete \(no studio\.html\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Writes `node_modules/<name>` under `dir` with a package.json and optional extra files. */
function fakePackage(dir: string, pkg: Record<string, unknown>, files: Record<string, string> = {}): string {
  const root = join(dir, "node_modules", String(pkg.name));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

describe("licence notices", () => {
  it("lists every bundled third-party package with its licence text, and no workspace code", () => {
    const dir = mkdtempSync(join(tmpdir(), "swarmloom-notices-"));
    try {
      const app = join(dir, "app");
      mkdirSync(app);
      writeFileSync(
        join(app, "package.json"),
        JSON.stringify({ name: "app", dependencies: { lib: "1" }, optionalDependencies: { absent: "1" } }),
      );
      const lib = fakePackage(
        app,
        {
          name: "lib",
          version: "1.0.0",
          license: "Apache-2.0",
          dependencies: { small: "2", "@types/lib": "1", "lib-linux-x64": "1" },
        },
        { LICENSE: "Apache licence of lib", "NOTICE.txt": "lib notice" },
      );
      fakePackage(app, { name: "small", version: "2.0.0", license: "MIT", author: { name: "Ada" } });
      fakePackage(app, { name: "lib-linux-x64", version: "1.0.0", license: "MIT", os: ["linux"] });

      const text = renderNotices(collectNotices(dependencyClosure(app)));
      expect(text).toContain("lib 1.0.0\nLicense: Apache-2.0");
      expect(text).toContain("Apache licence of lib");
      expect(text).toContain("lib notice");
      expect(text).toContain("Copyright (c) Ada");
      expect(text).not.toMatch(/lib-linux-x64|@types|^app /m);
      // esbuild metafile inputs: workspace sources and plugin namespaces are not packages.
      const inputs = { "../app/node_modules/lib/index.js": {}, "src/main.ts": {}, "stub:@swarmloom/adapter-pdf": {} };
      expect(bundledPackages([{ inputs }], join(dir, "work"))).toEqual([lib]);
      expect(renderNotices([])).toContain("no third-party software");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists core-js, which pdf.js ships pre-bundled, with the version and copyright it records", () => {
    const dir = mkdtempSync(join(tmpdir(), "swarmloom-notices-"));
    try {
      const store = `version: '3.51.0',\n  mode: IS_PURE ? 'pure' : 'global',\n  copyright: '© 2013 Denis Pushkarev'`;
      const pdfjs = fakePackage(
        dir,
        { name: "pdfjs-dist", version: "6.5.438", license: "Apache-2.0" },
        { LICENSE: "Apache licence of pdf.js", "legacy/build/pdf.mjs": `push({\n  ${store}\n});` },
      );
      const text = renderNotices(collectNotices([pdfjs]));
      expect(text).toContain("core-js 3.51.0\nLicense: MIT");
      expect(text).toContain("© 2013 Denis Pushkarev\n\nPermission is hereby granted");
      rmSync(join(pdfjs, "legacy"), { recursive: true });
      expect(() => collectNotices([pdfjs])).toThrow(/no core-js record/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists the KaTeX fonts katex ships under the SIL Open Font License, not only katex's MIT licence", () => {
    const katex = realpathSync(join(import.meta.dirname, "../../../packages/adapter-markdown/node_modules/katex"));
    const text = renderNotices(collectNotices([katex]));
    expect(text).toMatch(/^KaTeX fonts as shipped in katex \S+\nLicense: OFL-1\.1$/m);
    expect(text).toContain("Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)\n");
    expect(text).toContain("with Reserved Font Names KaTeX_AMS,");
    expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("lists the Draco (Apache-2.0) and meshoptimizer decoders three ships, which its MIT notice does not cover", () => {
    const three = realpathSync(join(import.meta.dirname, "../../../packages/adapter-three/node_modules/three"));
    const text = renderNotices(collectNotices([three]));
    expect(text).toMatch(/^draco3d as shipped in three \S+\nLicense: Apache-2\.0$/m);
    expect(text).toContain("Copyright 2016 The Draco Authors\n\n");
    expect(text).toContain("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION");
    expect(text).toMatch(/^meshoptimizer \d\S*\nLicense: MIT$/m);
    expect(text).toMatch(/Copyright \(C\) 2016-\d+, by Arseny Kapoulkine.*\n\nPermission is hereby granted/);
  });

  it("keeps Mediabunny's copyright line, which only its source headers carry and bundling drops", () => {
    const mediabunny = realpathSync(join(import.meta.dirname, "../../../packages/export/node_modules/mediabunny"));
    const text = renderNotices(collectNotices([mediabunny]));
    expect(text).toMatch(
      /\nCopyright \(c\) \d{4}-present, Vanilagy and contributors\n\n--- LICENSE ---\n\nMozilla Public/,
    );
    // Another MPL-2.0 package whose licence names no holder must be added to HEADER_COPYRIGHTS.
    const dir = mkdtempSync(join(tmpdir(), "swarmloom-notices-"));
    try {
      const mpl = fakePackage(dir, { name: "mpl", version: "1.0.0", license: "MPL-2.0" }, { LICENSE: "Mozilla" });
      expect(() => collectNotices([mpl])).toThrow(/mpl@1\.0\.0: MPL-2\.0 without a copyright line/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a package without licence text it cannot reproduce, and a missing dependency", () => {
    const dir = mkdtempSync(join(tmpdir(), "swarmloom-notices-"));
    try {
      const bare = fakePackage(dir, { name: "bare", version: "1.0.0", license: "BSD-3-Clause" });
      expect(() => collectNotices([bare])).toThrow(/bare@1\.0\.0: no licence file/);
      const needy = fakePackage(dir, { name: "needy", version: "1.0.0", dependencies: { gone: "1" } });
      expect(() => dependencyClosure(needy)).toThrow(/gone is not installed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("package audit", () => {
  it("passes a clean package and flags remote code, the test hook, missing notices and a stale zip", () => {
    const dir = mkdtempSync(join(tmpdir(), "swarmloom-audit-"));
    try {
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifestFor("chrome", "1.0.0")));
      writeFileSync(join(dir, "swarm.js"), "console.log(1);");
      // A listed embedded package passes, versioned by its host when it records no version of its own.
      const draco = { name: "draco3d", version: "as shipped in three 1.0.0", license: "Apache-2.0", source: "" };
      writeFileSync(join(dir, NOTICES_FILE), renderNotices([{ ...draco, texts: [] }]));
      writeFileSync(join(dir, "draco_wasm_wrapper.js"), "var DracoDecoderModule;");
      writeFileSync(join(dir, LICENSE_COPY), "MIT License");
      mkdirSync(join(dir, "pages"));
      writeFileSync(join(dir, "pages", "welcome.js"), "const site = 'https://example.com/'; open(site);");
      const zip = join(dir, "..", `${dir.split(/[\\/]/).pop()}.zip`);
      writeFileSync(zip, zipEntries(directoryEntries(dir)));
      expect(auditPackage(dir, "chrome", zip)).toEqual([]);

      writeFileSync(join(dir, "page.html"), '<script src="https://cdn.example/x.js"></script>');
      writeFileSync(join(dir, "background.js"), "globalThis.__swarmloomTest = {}; eval(code);");
      writeFileSync(join(dir, "pdf.worker.mjs"), 'var r="__core-js_shared__";');
      expect(auditPackage(dir, "chrome").join("\n")).toMatch(/pdf\.worker\.mjs: bundles core-js, which THIRD_PARTY/);
      rmSync(join(dir, NOTICES_FILE));
      const problems = auditPackage(dir, "chrome", zip).join("\n");
      expect(problems).toMatch(/page\.html: remote <script src>/);
      expect(problems).toMatch(/background\.js: eval/);
      expect(problems).toMatch(/test hook/);
      expect(problems).toMatch(/THIRD_PARTY_NOTICES\.txt is missing/);
      expect(problems).toMatch(/does not match/);
      rmSync(zip);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
