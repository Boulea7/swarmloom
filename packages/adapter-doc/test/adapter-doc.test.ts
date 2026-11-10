/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as CFB from "cfb";
import { describe, expect, it } from "vitest";
import {
  type DocBlock,
  DocError,
  type DocModel,
  type DocParagraph,
  detectDocContainer,
  docAdapter,
  loadDoc,
  parseDoc,
} from "../src/index";
import { renderDoc, TEXT_MODE_CLASS } from "../src/render/dom";
import { paginate } from "../src/render/paginate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name: string) => readFileSync(join(ROOT, "examples/doc", name));
const HEADERS = read("headers-footers-unicode.doc");
const TABLE = read("table.doc");
const REPORT = read("report.doc");
const ctx = { document, width: 800, theme: "light" as const };

const text = (p: DocParagraph) => p.runs.map((r) => (r.kind === "text" ? r.text : "")).join("");
const paragraphs = (blocks: DocBlock[]) => blocks.filter((b): b is DocParagraph => b.kind === "paragraph");
const ascii = (s: string) => new TextEncoder().encode(s);

/** Offset of the FIB (start of the WordDocument stream) in the file: "wIdent 0xA5EC, nFib 0x00C1" at a sector start. */
function fibOffset(bytes: Uint8Array): number {
  for (let at = 512; at + 4 <= bytes.length; at += 512) {
    if (bytes[at] === 0xec && bytes[at + 1] === 0xa5 && bytes[at + 2] === 0xc1 && bytes[at + 3] === 0x00) return at;
  }
  throw new Error("FIB not found");
}

function patched(edit: (bytes: Uint8Array, fib: number) => void): Uint8Array {
  const bytes = new Uint8Array(HEADERS);
  edit(bytes, fibOffset(bytes));
  return bytes;
}

function compoundFile(streams: Record<string, Uint8Array>): Uint8Array {
  const container = CFB.utils.cfb_new();
  for (const [name, content] of Object.entries(streams)) CFB.utils.cfb_add(container, `/${name}`, content);
  return Uint8Array.from(CFB.write(container, { type: "array" }) as ArrayLike<number>);
}

function parseError(bytes: Uint8Array): DocError {
  try {
    parseDoc(bytes);
  } catch (e) {
    if (e instanceof DocError) return e;
    throw e;
  }
  throw new Error("parseDoc accepted the input");
}

describe("adapter metadata", () => {
  it("registers as doc", () => {
    expect(docAdapter.id).toBe("doc");
    expect(docAdapter.extensions).toEqual(["doc"]);
    expect(docAdapter.mime).toEqual(["application/msword"]);
  });
});

describe("parser on the headers/footers sample", () => {
  const model: DocModel = parseDoc(new Uint8Array(HEADERS));
  const section = model.sections[0]!;

  it("recovers every paragraph and the heading", () => {
    expect(model.stats.paragraphs).toBe(12);
    expect(model.sections).toHaveLength(1);
    expect(model.warnings).toEqual([]);
    const body = paragraphs(section.blocks);
    expect(text(body[0]!)).toMatch(/^This is a fairly simple word document, over two pages/);
    const heading = body.find((p) => p.heading === 1);
    expect(heading && text(heading).trim()).toBe("Molière");
    expect(body.some((p) => text(p).includes("L'Avare ou l'École du mensonge"))).toBe(true);
    expect(body.some((p) => p.runs.some((r) => r.kind === "page-break"))).toBe(true);
  });

  it("reads the header and footer stories", () => {
    expect(text(paragraphs(section.header)[0]!)).toBe("This is a simple header, with a € euro symbol in it.");
    expect(text(paragraphs(section.footer)[0]!)).toBe("The footer, with Molière, has Unicode in it.");
  });

  it("pages only at the explicit break", () => {
    const pages = paginate(model.sections);
    expect(pages).toHaveLength(2);
    expect(text(paragraphs(pages[1]!.blocks)[0]!)).toMatch(/^This is page two\./);
  });
});

describe("parser on the table sample", () => {
  it("recovers the 5 x 6 table", () => {
    const model = parseDoc(new Uint8Array(TABLE));
    expect(model.stats.tables).toBe(1);
    const table = model.sections[0]!.blocks.find((b) => b.kind === "table");
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") return;
    expect(table.rows).toHaveLength(5);
    expect(table.rows.every((r) => r.cells.length === 6)).toBe(true);
  });
});

describe("parser on the generated report sample", () => {
  const model = parseDoc(new Uint8Array(REPORT));

  it("reads the title, headings, footnote, link and table", () => {
    expect(model.warnings).toEqual([]);
    const body = model.sections.flatMap((s) => paragraphs(s.blocks));
    expect(body[0]?.title).toBe(true);
    expect(body.filter((p) => p.heading > 0).map((p) => p.heading)).toEqual([1, 2, 2, 1, 1, 3]);
    expect(model.footnotes).toHaveLength(1);
    expect(body.some((p) => p.runs.some((r) => r.kind === "note" && r.mark === "1"))).toBe(true);
    const link = body.flatMap((p) => p.runs).find((r) => r.kind === "text" && r.href);
    expect(link).toMatchObject({ href: "https://github.com/Boulea7/swarmloom" });
    expect(model.stats.tables).toBe(1);
  });

  it("pages at the explicit break and at the landscape section, with inherited headers", () => {
    expect(model.sections).toHaveLength(2);
    const [portrait, landscape] = model.sections as [DocModel["sections"][0], DocModel["sections"][0]];
    expect(landscape.props.pageWidth).toBeGreaterThan(landscape.props.pageHeight);
    expect(portrait.props.pageWidth).toBeLessThan(portrait.props.pageHeight);
    expect(text(paragraphs(landscape.header)[0] ?? paragraphs(portrait.header)[0]!)).toContain("SwarmLoom");
    expect(paginate(model.sections)).toHaveLength(3);
  });
});

describe("rejections", () => {
  it("rejects encrypted and obfuscated files", () => {
    expect(parseError(patched((b, fib) => (b[fib + 0x0b]! |= 0x01))).code).toBe("encrypted");
    expect(parseError(patched((b, fib) => (b[fib + 0x0b]! |= 0x80))).code).toBe("encrypted");
  });

  it("rejects Word 6/95 files", () => {
    const word95 = patched((b, fib) => {
      b[fib + 2] = 0x68;
      b[fib + 3] = 0x00;
    });
    expect(parseError(word95).code).toBe("unsupported-version");
  });

  it("rejects non-Word compound files and encrypted OOXML packages", () => {
    expect(parseError(compoundFile({ Workbook: new Uint8Array(4096) })).code).toBe("not-word");
    expect(parseError(compoundFile({ EncryptedPackage: new Uint8Array(4096) })).code).toBe("encrypted");
  });

  it("rejects files that are not compound files", () => {
    expect(parseError(ascii("just text")).code).toBe("not-cfb");
    expect(parseError(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3])).code).toBe("not-cfb");
  });
});

describe("format routing (decisions-v1 F02)", () => {
  it.each([
    ["cfb", new Uint8Array(HEADERS)],
    ["zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])],
    ["rtf", ascii("{\\rtf1\\ansi hello}")],
    ["rtf", new Uint8Array([0xef, 0xbb, 0xbf, ...ascii("  {\\rtf1}")])],
    ["html", ascii('<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>x</body></html>')],
    ["html", ascii("<!DOCTYPE html>\n<html><body>x</body></html>")],
    ["html", ascii("<!-- saved --><HTML><HEAD></HEAD></HTML>")],
    ["mhtml", ascii('MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="x"\r\n')],
    ["mhtml", ascii("From: <Saved by Word>\r\nMIME-Version: 1.0\r\n")],
    [
      "wordml",
      ascii('<?xml version="1.0"?>\n<?mso-application progid="Word.Document"?>\n<w:wordDocument xmlns:w="x">'),
    ],
    ["word2", new Uint8Array([0xdb, 0xa5, 0x2d, 0x00])],
    ["word-dos", new Uint8Array([0x31, 0xbe, 0x00, 0x00, 0x00, 0xab])],
    ["unknown", ascii("plain text")],
  ])("detects %s", (kind, bytes) => {
    expect(detectDocContainer(bytes)).toBe(kind);
  });

  it.each([
    ["rtf", ascii("{\\rtf1\\ansi hello}")],
    ["html", ascii("<html><body>x</body></html>")],
    ["mhtml", ascii("MIME-Version: 1.0\r\n")],
    ["wordml", ascii('<?xml version="1.0"?><w:wordDocument xmlns:w="x"/>')],
  ])("loadDoc reports %s as a wrong format", async (format, bytes) => {
    const error = await loadDoc({ name: "x.doc", bytes }, ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocError);
    expect(error).toMatchObject({ code: "wrong-format", format });
  });

  it.each([
    ["Word 2.x", new Uint8Array([0xdb, 0xa5, 0x2d, 0x00, 0, 0, 0, 0])],
    ["Word for DOS", new Uint8Array([0x31, 0xbe, 0x00, 0x00, 0x00, 0xab, 0, 0])],
  ])("loadDoc rejects %s files explicitly", async (_label, bytes) => {
    await expect(loadDoc({ bytes }, ctx)).rejects.toMatchObject({ code: "unsupported-version" });
  });

  it("loadDoc rejects encrypted files", async () => {
    const bytes = patched((b, fib) => (b[fib + 0x0b]! |= 0x01));
    await expect(loadDoc({ bytes }, ctx)).rejects.toMatchObject({ code: "encrypted" });
    expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
  });
});

describe("renderer", () => {
  const model = parseDoc(new Uint8Array(HEADERS));

  it("renders text mode: structure in one body font, no character formatting", () => {
    const root = document.createElement("div");
    const sheets = renderDoc(model, root, 800, "text");
    expect(sheets).toHaveLength(2);
    const [first, second] = sheets as [HTMLElement, HTMLElement];
    expect(first.classList.contains(TEXT_MODE_CLASS)).toBe(true);
    expect(first.style.fontFamily).not.toBe("");
    expect(first.querySelector("header")?.textContent).toContain("€ euro");
    expect(first.querySelector("footer")?.textContent).toContain("Molière");
    expect(first.querySelector("h1")?.textContent?.trim()).toBe("Molière");
    expect(second.querySelector("article")?.textContent).toContain("This is page two.");
    expect(root.querySelector("img")).toBeNull();
    for (const span of Array.from(root.querySelectorAll("span:not(.swl-doc-marker)"))) {
      expect(span.getAttribute("style")).toBeNull();
    }
  });

  it("renders rich mode with character formatting", () => {
    const root = document.createElement("div");
    const sheets = renderDoc(model, root, 800, "rich");
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.classList.contains(TEXT_MODE_CLASS)).toBe(false);
    expect(root.querySelector("h1")?.getAttribute("style")).toMatch(/font-size/);
  });

  it("narrows sheets to small widths", () => {
    const root = document.createElement("div");
    const [sheet] = renderDoc(model, root, 360, "text");
    expect(Number.parseFloat(sheet!.style.width)).toBeLessThanOrEqual(336);
  });
});
