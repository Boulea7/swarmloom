/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "@swarmloom/adapter-odf/kit";
import type { AdapterContext } from "@swarmloom/core";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  DocumentError,
  epubAdapter,
  outlineNote,
  readBook,
  scopeSelector,
  scopeStylesheet,
  sniffEpub,
  splitSelectors,
} from "../src/index";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sample = new Uint8Array(readFileSync(join(ROOT, "examples/epub/loom-notes.epub")));
const ctx: AdapterContext = { document, width: 900, theme: "light" };

const CONTAINER = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const OPF = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="f" href="f.otf" media-type="font/otf"/></manifest><spine><itemref idref="c1"/></spine></package>`;

function book(encryption?: string): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 0 }] | Uint8Array> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(CONTAINER),
    "book.opf": strToU8(OPF),
    "c1.xhtml": strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hi</p></body></html>`),
  };
  if (encryption) files["META-INF/encryption.xml"] = strToU8(encryption);
  return zipSync(files);
}

const encryption = (algorithm: string, uri: string) =>
  `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;

describe("sniffEpub", () => {
  it.each([
    ["the EPUB sample", sample, true],
    [
      "an ODF-like package",
      zipSync({ mimetype: [strToU8("application/vnd.oasis.opendocument.text"), { level: 0 }] }),
      false,
    ],
    ["a deflated mimetype", zipSync({ mimetype: strToU8("application/epub+zip") }), false],
    ["plain text", strToU8("application/epub+zip"), false],
  ])("%s -> %s", (_name, bytes, expected) => {
    expect(sniffEpub(bytes.subarray(0, 512))).toBe(expected);
  });
});

describe("readBook", () => {
  it("reads metadata, spine, cover and both tables of contents from the sample", () => {
    const b = readBook(ZipArchive.open(sample, "epub"), window);
    expect(b).toMatchObject({
      opfPath: "OEBPS/content.opf",
      title: "Loom Notes",
      language: "en",
      coverImage: "OEBPS/images/cover.png",
      fixedLayout: false,
    });
    expect(b.spine.map((s) => s.item.path)).toEqual([
      "OEBPS/text/cover.xhtml",
      "OEBPS/text/ch1.xhtml",
      "OEBPS/text/ch2.xhtml",
      "OEBPS/text/ch3.xhtml",
    ]);
    expect(b.toc).toEqual([
      { label: "Warp and Weft", depth: 0 },
      { label: "Counting threads", depth: 1 },
      { label: "织机笔记", depth: 0 },
      { label: "Finishing", depth: 0 },
    ]);
    expect(outlineNote(b.toc)).toBe("Outline: Warp and Weft / Counting threads / 织机笔记 / Finishing.");
  });

  it("keeps books whose only encrypted files are obfuscated fonts", () => {
    const b = readBook(
      ZipArchive.open(book(encryption("http://www.idpf.org/2008/embedding", "f.otf")), "epub"),
      window,
    );
    expect([...b.obfuscatedFonts]).toEqual(["f.otf"]);
  });

  it.each([
    ["AES-encrypted content", encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc", "c1.xhtml")],
    ["font obfuscation applied to a chapter", encryption("http://www.idpf.org/2008/embedding", "c1.xhtml")],
  ])("refuses DRM: %s", (_name, xml) => {
    expect(() => readBook(ZipArchive.open(book(xml), "epub"), window)).toThrow(
      expect.objectContaining({ code: "encrypted" }),
    );
  });
});

describe("book CSS scoping", () => {
  it("splits selector lists and scopes html, :root and body", () => {
    expect(splitSelectors('h1, a[title="x,y"], :is(p, li)')).toEqual(["h1", 'a[title="x,y"]', ":is(p, li)"]);
    expect(scopeSelector("body p.note", ".epub-s1")).toBe(".epub-html.epub-s1 .epub-body p.note");
    expect(scopeSelector("html", ".epub-s1")).toBe(".epub-html.epub-s1");
    expect(scopeSelector(":root > body.x", ".epub-s2")).toBe(".epub-html.epub-s2 > .epub-body.x");
    expect(scopeSelector(":host p", ".epub-s1")).toBeNull();
  });

  it("drops imports and print rules, resolves urls in the archive and neutralises fixed positioning", () => {
    const css = `@import url("https://example.invalid/a.css");
      .a { background: url("../img/x.png"); position: fixed; }
      .b { background-image: url(https://example.invalid/t.png); }
      @media print { .c { color: red; } }`;
    const out = scopeStylesheet(
      css,
      ".epub-s1",
      "OEBPS/css/book.css",
      window,
      (href, base) => (href === "../img/x.png" && base === "OEBPS/css/book.css" ? "blob:x" : null),
      () => null,
    );
    expect(out.css).not.toContain("example.invalid");
    expect(out.css).not.toContain(".c");
    expect(out.css).toContain('url("blob:x")');
    expect(out.css).toMatch(/position: absolute/);
    expect(out.css).toContain(".epub-html.epub-s1 .a");
  });
});

describe("rejections", () => {
  it("refuses a malformed zip", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(epubAdapter.load({ name: "bad.epub", bytes }, ctx)).rejects.toMatchObject({
      name: "DocumentError",
      code: "malformed",
    });
  });

  it("refuses an encrypted book with a clear message", async () => {
    const bytes = book(encryption("http://www.w3.org/2001/04/xmlenc#aes256-cbc", "c1.xhtml"));
    const error = await epubAdapter.load({ name: "drm.epub", bytes }, ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentError);
    expect(String((error as Error).message)).toMatch(/DRM/);
  });
});
