import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORMAT_META as REGISTRY } from "@swarmloom/formats/meta";
import { describe, expect, it } from "vitest";
import { supportsModernBuild } from "../../../packages/adapter-pdf/src/runtime";
import { fileHandlerAccept, releaseVersion, shellFiles, splitPdfBuilds, warmFiles, webManifest } from "../build/pwa";
import { acceptAttribute, availableFormats } from "../src/formats-meta";
import { pdfBuild } from "../src/sw/pdf-build";

type Item = Parameters<typeof shellFiles>[0][string];

const chunk = (fileName: string, extra: Partial<Item> = {}): Item => ({ type: "chunk", fileName, ...extra });
const asset = (fileName: string, source: string): Item => ({ type: "asset", fileName, originalFileNames: [source] });

describe("PWA manifest", () => {
  it("registers every extension the bundled registry opens, optional formats included", () => {
    const bundled = availableFormats(REGISTRY.map((f) => f.id));
    // Nothing the bundled registry lacks; the Lottie adapter ships in it.
    expect(fileHandlerAccept()).toEqual(fileHandlerAccept(bundled));
    const manifest = webManifest() as {
      file_handlers: { accept: Record<string, string[]> }[];
      share_target: { params: { files: { accept: string[] }[] } };
    };
    const handled = Object.values(manifest.file_handlers[0]?.accept ?? {}).flat();
    const shared = manifest.share_target.params.files[0]?.accept ?? [];
    for (const ext of acceptAttribute(bundled).split(",")) {
      expect([ext, handled.includes(ext), shared.includes(ext)]).toEqual([ext, true, true]);
    }
  });
});

describe("PWA precache", () => {
  it("warms each lazy entry with its static imports and URL assets, whole or not at all", () => {
    const items = [
      chunk("assets/index.js", { isEntry: true, imports: ["assets/shared.js"] }),
      chunk("assets/shared.js"),
      chunk("assets/markdown.js", { isDynamicEntry: true, imports: ["assets/lib.js", "assets/shared.js"] }),
      chunk("assets/lib.js", {
        imports: ["assets/purify.js"],
        viteMetadata: { importedCss: new Set(["assets/lib.css"]) },
      }),
      chunk("assets/purify.js"),
      // The PDF reader opens offline only with its worker script and the main-thread fallback, in
      // both builds: browsers without the modern build's built-ins (Chrome 116-118) load the legacy one.
      chunk("assets/pdf-reader.js", {
        isDynamicEntry: true,
        viteMetadata: { importedAssets: new Set(["assets/pdf.worker.mjs", "assets/pdf.worker-legacy.mjs"]) },
      }),
      asset("assets/pdf.worker.mjs", "/pdfjs-dist/build/pdf.worker.min.mjs"),
      asset("assets/pdf.worker-legacy.mjs", "/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
      chunk("assets/pdf.worker.js", { isDynamicEntry: true, moduleIds: ["/pdfjs-dist/build/pdf.worker.min.mjs"] }),
      chunk("assets/pdf.worker-legacy.js", {
        isDynamicEntry: true,
        moduleIds: ["/pdfjs-dist/legacy/build/pdf.worker.min.mjs"],
      }),
      chunk("assets/pdf-legacy.js", { isDynamicEntry: true, moduleIds: ["/pdfjs-dist/legacy/build/pdf.mjs"] }),
      // Three's Draco decoders (never loaded by Studio) and loaders importing them stay cold.
      chunk("assets/model-reader.js", {
        isDynamicEntry: true,
        viteMetadata: { importedAssets: new Set(["assets/draco.wasm"]) },
      }),
      asset("assets/draco.wasm", "/three/examples/jsm/libs/draco/draco_decoder.wasm"),
      chunk("assets/draco-loader.js", { isDynamicEntry: true, imports: ["assets/draco.js"] }),
      chunk("assets/draco.js", {
        isDynamicEntry: true,
        moduleIds: ["/three/examples/jsm/libs/draco/draco_decoder.js"],
      }),
    ];
    const bundle = Object.fromEntries(items.map((item) => [item.fileName, item]));
    const shell = shellFiles(bundle);
    expect(shell).toContain("assets/shared.js");
    const warm = warmFiles(bundle, shell);
    // The worker fetches the common files and one pdf.js build, the one its engine runs.
    const split = splitPdfBuilds(bundle, warm);
    expect(split.pdf).toEqual({
      modern: ["assets/pdf.worker.js", "assets/pdf.worker.mjs"],
      legacy: ["assets/pdf-legacy.js", "assets/pdf.worker-legacy.js", "assets/pdf.worker-legacy.mjs"],
    });
    expect(split.common).toContain("assets/pdf-reader.js");
    expect([...split.common, ...split.pdf.modern, ...split.pdf.legacy].sort()).toEqual(warm);
    expect(warm).toEqual([
      "assets/lib.css",
      "assets/lib.js",
      "assets/markdown.js",
      "assets/model-reader.js",
      "assets/pdf-legacy.js",
      "assets/pdf-reader.js",
      "assets/pdf.worker-legacy.js",
      "assets/pdf.worker-legacy.mjs",
      "assets/pdf.worker.js",
      "assets/pdf.worker.mjs",
      "assets/purify.js",
    ]);
  });

  it("warms the pdf.js build the PDF reader picks", () => {
    // Every built-in adapter-pdf's runtime needs for the modern build, stubbed present, then
    // removed one at a time: the worker and the reader must agree each time.
    const builtIns: [object, string][] = [
      [Promise, "withResolvers"],
      [Promise, "try"],
      [Math, "sumPrecise"],
      [Map.prototype, "getOrInsertComputed"],
      [Uint8Array, "fromBase64"],
      [Uint8Array.prototype, "toBase64"],
    ];
    const saved = builtIns.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
    const stub = (target: object, key: string) =>
      Object.defineProperty(target, key, { configurable: true, writable: true, value: () => undefined });
    try {
      for (const [target, key] of builtIns) stub(target, key);
      expect([pdfBuild(), supportsModernBuild()]).toEqual(["modern", true]);
      for (const [target, key] of builtIns) {
        Reflect.deleteProperty(target, key);
        expect([key, pdfBuild(), supportsModernBuild()]).toEqual([key, "legacy", false]);
        stub(target, key);
      }
    } finally {
      builtIns.forEach(([target, key], i) => {
        const descriptor = saved[i];
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else Reflect.deleteProperty(target, key);
      });
    }
  });

  it("versions a release by file content, so a manifest-only change ships a new worker", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-pwa-"));
    try {
      writeFileSync(join(dir, "index.html"), "<!doctype html>");
      writeFileSync(join(dir, "manifest.webmanifest"), '{"name":"SwarmLoom Studio"}');
      const files = ["./", "manifest.webmanifest"];
      const before = releaseVersion(dir, files);
      expect(releaseVersion(dir, [...files].reverse())).toBe(before);
      writeFileSync(join(dir, "manifest.webmanifest"), '{"name":"SwarmLoom"}');
      expect(releaseVersion(dir, files)).not.toBe(before);
      expect(() => releaseVersion(dir, ["missing.png"])).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
