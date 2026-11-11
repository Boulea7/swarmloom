// @vitest-environment node
/// <reference types="node" />
import { fileURLToPath } from "node:url";
import { build, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("CDN adapters build", () => {
  it("emits worker and decoder assets as files instead of inlining them", async () => {
    const result = await build({
      root,
      configFile: `${root}/vite.config.ts`,
      mode: "adapters",
      logLevel: "silent",
      build: { write: false, sourcemap: false, minify: false },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rolldown.RolldownOutput).output);
    const chunks = output.filter((o) => o.type === "chunk");

    // Library mode inlined both pdf.js workers (3.5 MB adapter-pdf chunk) and both Draco decoders.
    expect(
      chunks.filter((c) => /data:(text\/javascript|application\/wasm);base64,/.test(c.code)).map((c) => c.fileName),
    ).toEqual([]);
    expect(
      output.filter((o) => o.type === "asset" && /^assets\/pdf\.worker\.min-.+\.mjs$/.test(o.fileName)),
    ).toHaveLength(2);
    // The global build imports the entry and calls loadAdapter(); chunk loads must not touch the host page.
    expect(chunks.find((c) => c.isEntry)?.exports).toContain("loadAdapter");
    expect(chunks.filter((c) => c.code.includes("vite:preloadError")).map((c) => c.fileName)).toEqual([]);
  }, 120_000);
});
