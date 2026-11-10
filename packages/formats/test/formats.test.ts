import type { SourceInput } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import { detect, formats, load } from "../src/index";

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p)));
const utf16 = (s: string): number[] => Array.from(s).flatMap((c) => [c.charCodeAt(0), 0]);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

describe("detect", () => {
  const cases: [string, SourceInput, string | null][] = [
    ["pdf magic", { bytes: bytes("%PDF-1.7\n") }, "pdf"],
    [
      "png magic beats a wrong name",
      { name: "a.txt", bytes: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
      "image",
    ],
    ["jpeg magic", { bytes: bytes([0xff, 0xd8, 0xff, 0xe0]) }, "image"],
    ["webp magic", { bytes: bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ") }, "image"],
    ["glb magic", { bytes: bytes("glTF", [2, 0, 0, 0]) }, "three"],
    ["zip by name", { name: "deck.PPTX", bytes: bytes(ZIP) }, "slides"],
    ["zip by part name", { bytes: bytes(ZIP, "....[Content_Types].xml....word/document.xml") }, "docx"],
    ["cfb by name", { name: "old.xls", bytes: bytes(CFB) }, "sheet"],
    ["cfb by stream name", { bytes: bytes(CFB, [0, 0], utf16("WordDocument")) }, "doc"],
    [
      "svg text with prolog",
      { text: '<?xml version="1.0"?>\n<!-- x -->\n<svg xmlns="http://www.w3.org/2000/svg"/>' },
      "svg",
    ],
    ["svg bytes with BOM", { bytes: bytes([0xef, 0xbb, 0xbf], " <svg viewBox='0 0 1 1'></svg>") }, "svg"],
    ["html text", { text: "<!DOCTYPE html><title>x</title>" }, "html"],
    ["extension from url path", { url: "https://example.com/docs/README.md?raw=1#top" }, "markdown"],
    ["mime with parameters", { type: "text/csv; charset=utf-8" }, "sheet"],
    ["name beats text sniffing", { name: "notes.md", text: "<svg></svg>" }, "markdown"],
    ["live element", { element: document.body }, "dom"],
    ["unknown", { name: "archive.xyz", text: "hello" }, null],
  ];

  it.each(cases)("%s", async (_label, input, expected) => {
    expect(await detect(input)).toBe(expected);
  });
});

describe("registry", () => {
  it("matches the metadata of every adapter it loads", async () => {
    for (const entry of formats) {
      const adapter = await entry.loader();
      expect({ id: adapter.id, extensions: adapter.extensions, mime: adapter.mime }).toEqual({
        id: entry.id,
        extensions: entry.extensions,
        mime: entry.mime,
      });
    }
  });
});

describe("load", () => {
  it("rejects unknown input and forwards to the detected adapter", async () => {
    await expect(load({ name: "x.unknown" })).rejects.toThrow("Unsupported input");
    await expect(load({ name: "a.md", text: "# hi" })).rejects.toThrow("not implemented yet");
  });
});
