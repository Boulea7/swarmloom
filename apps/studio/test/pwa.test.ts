import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { releaseVersion, shellFiles, WARM_MAX_BYTES, warmFiles } from "../build/pwa";

type Item = Parameters<typeof shellFiles>[0][string];

const chunk = (fileName: string, extra: Partial<Item> = {}): Item => ({ type: "chunk", fileName, code: "x", ...extra });

describe("PWA precache", () => {
  it("warms each lazy entry with its static imports, whole or not at all", () => {
    const items = [
      chunk("assets/index.js", { isEntry: true, imports: ["assets/shared.js"] }),
      chunk("assets/shared.js"),
      chunk("assets/markdown.js", { isDynamicEntry: true, imports: ["assets/lib.js", "assets/shared.js"] }),
      chunk("assets/lib.js", {
        imports: ["assets/purify.js"],
        viteMetadata: { importedCss: new Set(["assets/lib.css"]) },
      }),
      chunk("assets/purify.js"),
      // A loader whose static dependency is over the cap is left to the runtime cache with it.
      chunk("assets/loader.js", { isDynamicEntry: true, imports: ["assets/three.js"] }),
      chunk("assets/three.js", { code: "x".repeat(WARM_MAX_BYTES + 1) }),
      chunk("assets/pdf-legacy.js", { isDynamicEntry: true, moduleIds: ["/pdfjs-dist/legacy/build/pdf.mjs"] }),
    ];
    const bundle = Object.fromEntries(items.map((item) => [item.fileName, item]));
    const shell = shellFiles(bundle);
    expect(shell).toContain("assets/shared.js");
    expect(warmFiles(bundle, shell)).toEqual([
      "assets/lib.css",
      "assets/lib.js",
      "assets/markdown.js",
      "assets/purify.js",
    ]);
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
