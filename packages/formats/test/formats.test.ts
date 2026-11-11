/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Adapter, SourceInput } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import { detect, type FormatEntry, fetchSource, formats, inspect, load, SourceError } from "../src/index";
import { bytes, makeCfb, makeZip, wordStream } from "./fixtures";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const LOTTIE = '{"v":"5.12.0","fr":30,"ip":0,"op":120,"w":480,"h":300,"layers":[]}';
const binarySTL = (triangles: number): Uint8Array => {
  const out = new Uint8Array(84 + triangles * 50);
  new DataView(out.buffer).setUint32(80, triangles, true);
  return out;
};

describe("detect", () => {
  const cases: [string, SourceInput, string | null][] = [
    ["pdf magic after junk", { bytes: bytes("\n\n%PDF-1.7\n") }, "pdf"],
    [
      "png magic beats a wrong name",
      { name: "a.txt", bytes: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
      "image",
    ],
    ["jpeg magic", { bytes: bytes([0xff, 0xd8, 0xff, 0xe0]) }, "image"],
    ["webp magic", { bytes: bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ") }, "image"],
    ["avif brand", { bytes: bytes([0, 0, 0, 28], "ftypavif") }, "image"],
    ["glb magic", { bytes: bytes("glTF", [2, 0, 0, 0]) }, "three"],
    ["binary stl by exact length", { bytes: binarySTL(3) }, "three"],
    [
      "docx by part name, no file name",
      { bytes: makeZip([{ name: "[Content_Types].xml" }, { name: "word/document.xml" }]) },
      "docx",
    ],
    ["xlsx content beats a .docx name", { name: "x.docx", bytes: makeZip([{ name: "xl/workbook.xml" }]) }, "sheet"],
    [
      "pptx from local headers only",
      { bytes: makeZip([{ name: "ppt/presentation.xml" }], { central: false }) },
      "slides",
    ],
    [
      "odp by mimetype entry",
      { bytes: makeZip([{ name: "mimetype", data: "application/vnd.oasis.opendocument.presentation" }]) },
      "odf",
    ],
    [
      "ods stays with the spreadsheet adapter",
      { bytes: makeZip([{ name: "mimetype", data: "application/vnd.oasis.opendocument.spreadsheet" }]) },
      "sheet",
    ],
    ["epub by mimetype entry", { bytes: makeZip([{ name: "mimetype", data: "application/epub+zip" }]) }, "epub"],
    ["ofd by root OFD.xml", { bytes: makeZip([{ name: "OFD.xml" }, { name: "Doc_0/Document.xml" }]) }, "ofd"],
    ["nameless xmind", { bytes: makeZip([{ name: "content.json" }, { name: "metadata.json" }]) }, "mindmap"],
    [
      "dotLottie by manifest and animation",
      { bytes: makeZip([{ name: "manifest.json" }, { name: "a/loop.json" }]) },
      "lottie",
    ],
    [
      "lottie json beats its .json name",
      { name: "loop.json", bytes: bytes([0xef, 0xbb, 0xbf], ` ${LOTTIE}`) },
      "lottie",
    ],
    ["pasted lottie json", { text: LOTTIE }, "lottie"],
    [
      "a plain .json file stays code",
      { name: "package.json", bytes: bytes('{"name":"x","version":"1.0.0","layers":[]}') },
      "code",
    ],
    ["rtf saved as .doc", { name: "letter.doc", bytes: bytes([0xef, 0xbb, 0xbf], "{\\rtf1\\ansi Hi}") }, "rtf"],
    ["notebook json", { text: '{\n "cells": [{ "cell_type": "markdown" }],\n "nbformat": 4\n}' }, "notebook"],
    ["asciicast v2", { text: '{"version": 2, "width": 80, "height": 24}\n[0.1, "o", "hi"]\n' }, "terminal"],
    ["git patch", { text: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n" }, "diff"],
    ["freemind map", { text: '<map version="1.0.1">\n<node TEXT="Root"/>\n</map>' }, "mindmap"],
    ["unknown zip falls back to the name", { name: "deck.PPTX", bytes: makeZip([{ name: "a.bin" }]) }, "slides"],
    ["plain zip archive is unsupported", { name: "files.zip", bytes: makeZip([{ name: "a.txt" }]) }, null],
    ["cfb WordDocument stream", { bytes: makeCfb([{ name: "WordDocument", content: wordStream(0) }]) }, "doc"],
    ["cfb Workbook stream", { bytes: makeCfb([{ name: "Workbook" }]) }, "sheet"],
    // Legacy .ppt/.xls are not buildable: only their CFB streams route them, to the adapter's "save as" message.
    ["cfb PowerPoint stream", { name: "old.ppt", bytes: makeCfb([{ name: "PowerPoint Document" }]) }, "slides"],
    ["a .ppt name alone", { name: "old.ppt" }, null],
    ["a .xls name alone", { name: "old.xls" }, null],
    ["csv with the Windows Excel mime", { type: "application/vnd.ms-excel", text: "a;b\n1;2\n3;4\n" }, "sheet"],
    [
      "truncated cfb falls back to a name scan",
      { bytes: bytes(CFB, [0, 0], Array.from("WordDocument", (c) => [c.charCodeAt(0), 0]).flat()) },
      "doc",
    ],
    [
      "svg text with prolog",
      { text: '<?xml version="1.0"?>\n<!-- x -->\n<svg xmlns="http://www.w3.org/2000/svg"/>' },
      "svg",
    ],
    ["svg bytes with BOM", { bytes: bytes([0xef, 0xbb, 0xbf], " <svg viewBox='0 0 1 1'></svg>") }, "svg"],
    ["html document", { text: "<!DOCTYPE html><title>x</title>" }, "html"],
    ["html fragment", { text: '<div class="card">\n  <p>Hello</p>\n</div>' }, "html"],
    [
      "markdown with leading html",
      { text: '<p align="center"><img src="logo.svg"></p>\n\n# Title\n\n- one\n- two\n' },
      "markdown",
    ],
    [
      "typescript code",
      { text: 'import { x } from "y";\n\nexport function f(a: number) {\n  return a + 1;\n}\n' },
      "code",
    ],
    ["python with comments", { text: "# util\nimport os\n\ndef main():\n    # run\n    return os.getcwd()\n" }, "code"],
    ["csv rows", { text: 'name,age,city\nAda,36,"London, UK"\nLinus,54,Portland\n' }, "sheet"],
    ["tsv rows", { text: "a\tb\tc\n1\t2\t3\n4\t5\t6\n" }, "sheet"],
    ["gltf json", { text: '{\n  "asset": { "version": "2.0" },\n  "scenes": []\n}' }, "three"],
    ["plain json", { text: '{ "name": "swarmloom" }' }, "code"],
    ["wavefront obj", { text: "# cube\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n" }, "three"],
    ["ascii stl", { text: "solid tri\n  facet normal 0 0 1\n  endfacet\nendsolid\n" }, "three"],
    [
      "prose reads as markdown",
      { text: "This is a short note about the weekend.\nWe will meet near the river at noon." },
      "markdown",
    ],
    [
      "utf-16 text with BOM",
      { bytes: bytes([0xff, 0xfe], Array.from("# Hi\n\n- a\n", (c) => [c.charCodeAt(0), 0]).flat()) },
      "markdown",
    ],
    ["extension from url path", { url: "https://example.com/docs/README.md?raw=1#top" }, "markdown"],
    ["mime with parameters", { type: "text/csv; charset=utf-8" }, "sheet"],
    ["generic mime is ignored", { type: "application/octet-stream", text: "# Notes\n\n- a\n- b\n" }, "markdown"],
    ["name beats text heuristics", { name: "notes.md", text: "<svg></svg>" }, "markdown"],
    ["live element", { element: document.body }, "dom"],
    ["unknown binary", { name: "clip.xyz", bytes: bytes([0, 1, 2, 3, 0, 0, 7]) }, null],
    ["empty text", { text: "   " }, null],
  ];

  it.each(cases)("%s", async (_label, input, expected) => {
    expect(await detect(input)).toBe(expected);
  });

  it("flags encrypted containers", () => {
    const ooxml = makeCfb([{ name: "EncryptionInfo" }, { name: "EncryptedPackage" }]);
    expect(inspect({ name: "secret.xlsx", bytes: ooxml })).toEqual({ id: "sheet", encrypted: true });
    expect(inspect({ bytes: makeCfb([{ name: "WordDocument", content: wordStream(0x0100) }]) })).toEqual({
      id: "doc",
      encrypted: true,
    });
    expect(inspect({ bytes: makeZip([{ name: "word/document.xml", flags: 1 }]) }).encrypted).toBe(true);
  });

  it("restricts results to the given registry", async () => {
    const onlyMarkdown = formats.filter((f) => f.id === "markdown");
    expect(await detect({ name: "a.md" }, onlyMarkdown)).toBe("markdown");
    expect(await detect({ bytes: bytes("%PDF-1.4") }, onlyMarkdown)).toBeNull();
  });

  // Example files shipped in the repo: named detection must hit the extension's format, and binary
  // formats must also be recognised from content alone.
  const CONTENT_ONLY = new Set(["docx", "doc", "pdf", "image", "slides", "three", "svg"]);
  const examples = ["examples", "assets/brand"]
    .map((dir) => join(ROOT, dir))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir).map((file) => join(dir, file)))
    .filter((path) => statSync(path).isFile());

  it.each(examples)("repo example %s", async (path) => {
    const ext = extname(path).slice(1).toLowerCase();
    const expected = formats.find((f) => f.extensions.includes(ext))?.id ?? null;
    const content = new Uint8Array(readFileSync(path));
    expect(await detect({ name: path, bytes: content })).toBe(expected);
    if (expected && CONTENT_ONLY.has(expected) && ext !== "csv")
      expect(await detect({ bytes: content })).toBe(expected);
  });

  it("classifies repo sources without names", async () => {
    const read = (rel: string) => ({ bytes: new Uint8Array(readFileSync(join(ROOT, rel))) });
    expect(await detect(read("examples/README.md"))).toBe("markdown");
    expect(await detect(read("packages/formats/src/detect.ts"))).toBe("code");
    expect(await detect({ name: ".github/workflows/ci.yml" })).toBe("code");
  });
});

describe("load", () => {
  const ctx = { document, width: 800, theme: "light" as const };
  const blueprint = {
    version: 1 as const,
    source: { type: "fake" },
    size: { w: 1, h: 1 },
    background: "#fff",
    layers: [],
  };
  const adapter = (load: Adapter["load"]): Adapter => ({
    id: "fake",
    label: "Fake",
    extensions: ["fake"],
    mime: [],
    load,
  });
  const registry = (loader: FormatEntry["loader"]): FormatEntry[] => [
    { id: "fake", label: "Fake", extensions: ["fake"], mime: ["text/x-fake"], loader },
  ];
  const ok = registry(async () => adapter(async () => ({ blueprint })));
  const codeOf = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      (error: unknown) => (error instanceof SourceError ? error.code : String(error)),
    );

  it("loads through the detected adapter and honours a format override", async () => {
    await expect(load({ name: "a.fake", text: "x" }, ctx, { registry: ok })).resolves.toEqual({ blueprint });
    await expect(load({ name: "a.txt", text: "x" }, ctx, { registry: ok, format: "text/x-fake" })).resolves.toEqual({
      blueprint,
    });
    // Legacy third argument: the registry itself.
    await expect(load({ name: "a.fake", text: "x" }, ctx, ok)).resolves.toEqual({ blueprint });
  });

  it("rejects bad inputs with a code and a helpful message", async () => {
    const failing = registry(() => Promise.reject(new Error("chunk 404")));
    const locked = registry(async () =>
      adapter(() => Promise.reject(Object.assign(new Error("pw"), { name: "PasswordException" }))),
    );
    expect(await codeOf(load({ name: "a.xyz", bytes: bytes([0, 1, 2]) }, ctx, { registry: ok }))).toBe("unsupported");
    expect(await codeOf(load({ name: "a.fake", bytes: new Uint8Array(11) }, ctx, { registry: ok, maxBytes: 10 }))).toBe(
      "too-large",
    );
    expect(await codeOf(load({ name: "a.fake", text: "" }, ctx, { registry: ok }))).toBe("empty");
    expect(await codeOf(load({ name: "a.fake", text: "x" }, ctx, { registry: failing }))).toBe("adapter-unavailable");
    expect(await codeOf(load({ name: "a.fake", text: "x" }, ctx, { registry: locked }))).toBe("encrypted");
    const zip = makeZip([{ name: "word/document.xml", flags: 1 }]);
    expect(await codeOf(load({ name: "a.docx", bytes: zip }, ctx))).toBe("encrypted");
    await expect(
      load({ name: "big.fake", bytes: new Uint8Array(3 << 20) }, ctx, { maxBytes: 1 << 20 }),
    ).rejects.toThrow("big.fake is 3 MB; the limit is 1 MB");
  });

  it("downloads url-only inputs with the size limit", async () => {
    const response = (body: string, headers: Record<string, string> = {}) =>
      new Response(body, { headers: { "content-type": "text/x-fake; charset=utf-8", ...headers } });
    const fetchOk = async () => response("hello");
    const input = await fetchSource("https://example.com/files/note", { fetch: fetchOk });
    expect(input).toMatchObject({ name: "note", type: "text/x-fake", url: "https://example.com/files/note" });
    expect(new TextDecoder().decode(input.bytes)).toBe("hello");
    const big = async () => response("x".repeat(64));
    expect(await codeOf(fetchSource("https://example.com/a.md", { fetch: big, maxBytes: 16 }))).toBe("too-large");
    const missing = async () => new Response("nope", { status: 404 });
    expect(await codeOf(fetchSource("https://example.com/a.md", { fetch: missing }))).toBe("fetch-failed");
    expect(await codeOf(fetchSource("javascript:alert(1)"))).toBe("fetch-failed");
  });
});
