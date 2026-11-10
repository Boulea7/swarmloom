// @vitest-environment node
/// <reference types="node" />
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("SSR", () => {
  it("evaluates without a DOM and only fails when asked to register", async () => {
    expect(typeof globalThis.document).toBe("undefined");
    // Bundle from source (workspace packages through their source condition) and evaluate the result in plain Node.
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      conditions: ["@swarmloom/source"],
      logLevel: "silent",
    });
    const code = result.outputFiles[0]?.text ?? "";
    const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    expect(mod.TAG_NAME).toBe("swarm-loom");
    expect(() => mod.define()).toThrow("customElements is not available");
  });
});
