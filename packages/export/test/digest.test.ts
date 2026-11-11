import { describe, expect, it } from "vitest";
import { blueprintSha256 } from "../src/render/digest";

const BYTES: Record<string, number[]> = {
  "blob:http://127.0.0.1:4001/1f0c": [1, 2, 3],
  "blob:http://127.0.0.1:4002/9e7a": [1, 2, 3],
  "blob:http://127.0.0.1:4002/77b2": [4, 5, 6],
};
const read = async (url: string) => {
  const bytes = BYTES[url];
  if (!bytes) throw new Error("revoked");
  return Uint8Array.from(bytes).buffer;
};

function withImage(src: string) {
  return {
    version: 1 as const,
    source: { type: "slides" },
    size: { w: 10, h: 10 },
    background: "#fff",
    css: `@font-face{font-family:A;src:url(${src})}`,
    layers: [{ id: "i", kind: "image" as const, box: { x: 0, y: 0, w: 10, h: 10 }, src }],
  };
}

describe("blueprintSha256", () => {
  it("names blob: URLs by their bytes, so only a change of content changes the hash", async () => {
    const [a, b, c, gone] = await Promise.all(
      ["blob:http://127.0.0.1:4001/1f0c", "blob:http://127.0.0.1:4002/9e7a", "blob:http://127.0.0.1:4002/77b2"]
        .concat("blob:http://127.0.0.1:4002/dead")
        .map((src) => blueprintSha256(withImage(src), undefined, undefined, read)),
    );
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(gone).toMatch(/^[0-9a-f]{64}$/);
  });
});
