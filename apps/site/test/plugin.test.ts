// @vitest-environment node
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DISPLAY_FONT_LICENSE_FILE, sitePlugin } from "../build/plugin";
import { DISPLAY_FONT_FILE } from "../src/render/head";

const root = fileURLToPath(new URL("..", import.meta.url));

interface EmittedAsset {
  fileName: string;
  source: string | Uint8Array;
}

describe("site build", () => {
  it("deploys the display font together with its OFL licence", () => {
    const [pages] = sitePlugin({ root, siteUrl: "https://example.test/", brandDir: join(root, "no-brand") });
    const files = new Map<string, string | Uint8Array>();
    const context = {
      emitFile(asset: EmittedAsset) {
        files.set(asset.fileName, asset.source);
        return asset.fileName;
      },
    };
    const generateBundle = pages?.generateBundle as unknown as (this: typeof context) => void;
    generateBundle.call(context);

    expect(files.has(DISPLAY_FONT_FILE)).toBe(true);
    expect(DISPLAY_FONT_LICENSE_FILE).toBe("fonts/OFL.txt");
    const licence = String(files.get(DISPLAY_FONT_LICENSE_FILE));
    expect(licence).toContain("Copyright 2022 The Bricolage Grotesque Project Authors");
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
});
