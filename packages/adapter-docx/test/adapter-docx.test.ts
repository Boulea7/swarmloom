/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  checkDocxPackage,
  checkXml,
  createDocxAdapter,
  DocxError,
  docxAdapter,
  isSafeEntryName,
  loadDocx,
  MAX_XML_DEPTH,
} from "../src/index";
import { coreTitle, headingStyles, openDocxPackage, paragraphStyles } from "../src/package";
import {
  counterPairs,
  fontStack,
  InputError,
  parseContent,
  primaryFamilies,
  reparseContent,
  sanitizeCss,
  sanitizeTree,
  substituteFor,
  withFontFallbacks,
} from "../src/paged/index";
import { PLAIN_PAGE, renderPlain } from "../src/plain";
import {
  adjustPageBreaks,
  applyDefaultParagraphStyle,
  fitSheets,
  inheritHeadersAndFooters,
  lengthPx,
  numberPageFields,
  styleClass,
  tagPageNumbers,
  unwrapNoteReferenceRuns,
} from "../src/preview";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SAMPLE = readFileSync(join(ROOT, "examples/docx/report.docx"));
const LEGACY_DOC = readFileSync(join(ROOT, "examples/doc/headers-footers-unicode.doc"));
const sample = () => new Uint8Array(SAMPLE);
const ctx = { document, width: 800, theme: "light" as const };

async function zip(files: Record<string, string>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [name, text] of Object.entries(files)) z.file(name, text, { createFolders: false });
  return z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

const SAVED = "lastRenderedPageBreak";
const CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function utf16(text: string): number[] {
  return Array.from(text).flatMap((c) => [c.charCodeAt(0), 0]);
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe("adapter metadata", () => {
  it("registers as docx", () => {
    expect(docxAdapter.id).toBe("docx");
    expect(docxAdapter.extensions).toEqual(["docx"]);
    expect(docxAdapter.mime).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(createDocxAdapter({ renderer: "plain" }).id).toBe("docx");
  });
});

describe("XML safety", () => {
  it("accepts ordinary WordprocessingML with comments and CDATA", () => {
    expect(() =>
      checkXml(`<?xml version="1.0"?><!-- c --><w:document ${W}><![CDATA[<x>]]><w:body/></w:document>`, "a.xml"),
    ).not.toThrow();
  });

  it.each([
    ["DOCTYPE", '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'],
    ["ENTITY", '<x><!ENTITY a "b"></x>'],
    ["deep nesting", `${"<a>".repeat(MAX_XML_DEPTH + 1)}${"</a>".repeat(MAX_XML_DEPTH + 1)}`],
  ])("rejects %s", (_label, xml) => {
    expect(errorCode(() => checkXml(xml, "word/document.xml"))).toBe("unsafe");
  });

  it("allows nesting up to the limit", () => {
    expect(() => checkXml(`${"<a>".repeat(MAX_XML_DEPTH)}${"</a>".repeat(MAX_XML_DEPTH)}`, "x.xml")).not.toThrow();
  });

  it("rejects a package whose document part declares a DTD", async () => {
    const bytes = await zip({
      "[Content_Types].xml": CONTENT_TYPES,
      "word/document.xml": `<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY lol "lol">]><w:document ${W}><w:body/></w:document>`,
    });
    await expect(openDocxPackage(bytes)).rejects.toMatchObject({ code: "unsafe" });
  });
});

describe("ZIP checks", () => {
  it.each([
    ["word/document.xml", true],
    ["[Content_Types].xml", true],
    ["../evil.xml", false],
    ["word/../../evil.xml", false],
    ["/etc/passwd", false],
    ["C:/x.xml", false],
    ["word\\x.xml", false],
    ["", false],
  ])("entry name %j safe: %s", (name, safe) => {
    expect(isSafeEntryName(name)).toBe(safe);
  });

  it("rejects path traversal before unpacking", async () => {
    const bytes = await zip({
      "[Content_Types].xml": CONTENT_TYPES,
      "word/document.xml": `<w:document ${W}/>`,
      "../evil.xml": "<x/>",
    });
    expect(errorCode(() => checkDocxPackage(bytes))).toBe("corrupt");
  });

  it("enforces the entry limit", async () => {
    const bytes = await zip({
      "[Content_Types].xml": CONTENT_TYPES,
      "word/document.xml": `<w:document ${W}/>`,
      "a.xml": "<a/>",
    });
    expect(errorCode(() => checkDocxPackage(bytes, { maxEntries: 2, maxTotal: 1e9, maxRatio: 200 }))).toBe("too-large");
  });

  it("enforces the unpacked size limit", async () => {
    const bytes = await zip({ "[Content_Types].xml": CONTENT_TYPES, "word/document.xml": `<w:document ${W}/>` });
    expect(errorCode(() => checkDocxPackage(bytes, { maxEntries: 10, maxTotal: 16, maxRatio: 200 }))).toBe("too-large");
  });

  it("flags extreme compression ratios", async () => {
    const bytes = await zip({ "[Content_Types].xml": CONTENT_TYPES, "word/document.xml": "a".repeat(2 * 1024 * 1024) });
    expect(errorCode(() => checkDocxPackage(bytes))).toBe("too-large");
  });

  it("tells legacy, encrypted and foreign files apart", async () => {
    expect(errorCode(() => checkDocxPackage(new Uint8Array(LEGACY_DOC)))).toBe("legacy-doc");
    const encrypted = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...utf16("EncryptedPackage")]);
    expect(errorCode(() => checkDocxPackage(encrypted))).toBe("encrypted");
    expect(errorCode(() => checkDocxPackage(new TextEncoder().encode("hello world")))).toBe("not-docx");
    const workbook = await zip({ "[Content_Types].xml": CONTENT_TYPES, "xl/workbook.xml": "<workbook/>" });
    expect(errorCode(() => checkDocxPackage(workbook))).toBe("not-docx");
  });

  it("accepts the sample", () => {
    expect(checkDocxPackage(sample()).some((e) => e.name === "word/document.xml")).toBe(true);
  });
});

describe("package reading", () => {
  it("finds the main part, title and heading styles of the sample", async () => {
    const pkg = await openDocxPackage(sample());
    expect(pkg.main).toBe("word/document.xml");
    expect(coreTitle(pkg)).toBe("SwarmLoom Weave Report");
    const styles = paragraphStyles(pkg);
    const headings = headingStyles(styles);
    expect(headings.get("Heading1")).toEqual({ level: 1, title: false });
    expect(headings.get("Heading3")).toEqual({ level: 3, title: false });
    expect(headings.get("Title")).toEqual({ level: 1, title: true });
    expect(styles.get("ListBullet")?.numbering).not.toBeNull();
  });
});

describe("plain fallback renderer", () => {
  it("renders the sample as semantic HTML on page sheets", async () => {
    const pkg = await openDocxPackage(sample());
    const host = document.createElement("div");
    const result = renderPlain(pkg, host, { styles: paragraphStyles(pkg), savedPageBreaks: true });
    // Explicit page break plus a landscape second section.
    expect(result.pages).toHaveLength(3);
    expect(host.querySelectorAll(`section.${PLAIN_PAGE}`)).toHaveLength(3);
    const [first, second, third] = result.pages as [HTMLElement, HTMLElement, HTMLElement];
    expect(first.querySelector("h1.swl-plain-title")?.textContent).toContain("SwarmLoom Weave Report");
    expect(Array.from(first.querySelectorAll("h1"), (h) => h.textContent)).toContain("1. 概览 Overview");
    expect(first.querySelector("h2")?.textContent).toBe("1.1 本季亮点 Highlights");
    expect(first.querySelectorAll(".swl-plain-marker").length).toBeGreaterThanOrEqual(4);
    expect(first.querySelector("table td")).not.toBeNull();
    expect(first.querySelector("a[href^='https:']")).not.toBeNull();
    expect(second.querySelector("h3")?.textContent).toBe("3.1.1 小结 Summary");
    expect(third.querySelector("h1")?.textContent).toBe("附录 Appendix");
    expect(Number.parseFloat(third.style.width)).toBeGreaterThan(Number.parseFloat(first.style.width));
    expect(result.omitted.pictures).toBeGreaterThanOrEqual(1);
    expect(result.omitted.footnotes).toBe(1);
    expect(result.omitted.headersFooters).toBe(true);
  });

  it("numbers ordered lists", async () => {
    const pkg = await openDocxPackage(sample());
    const host = document.createElement("div");
    renderPlain(pkg, host, { styles: paragraphStyles(pkg), savedPageBreaks: false });
    const markers = Array.from(host.querySelectorAll(".swl-plain-marker"), (m) => m.textContent);
    expect(markers).toContain("1.");
    expect(markers).toContain("2.");
  });
});

describe("sheet helpers", () => {
  it("maps style ids to docx-preview classes", () => {
    expect(styleClass("Heading1")).toBe("swl-docx_heading1");
    expect(styleClass("List Bullet 2")).toBe("swl-docx_list-bullet-2");
  });

  it("parses plain lengths only", () => {
    expect(lengthPx("72pt")).toBe(96);
    expect(lengthPx("1in")).toBe(96);
    expect(lengthPx("816px")).toBe(816);
    expect(lengthPx("calc(100% - 10px)")).toBeNull();
  });

  it("narrows wide sheets with proportional margins", () => {
    const page = document.createElement("section");
    page.style.width = "612pt";
    page.style.minHeight = "792pt";
    page.style.paddingLeft = "72pt";
    page.style.paddingRight = "72pt";
    fitSheets([page], 400);
    expect(Number.parseFloat(page.style.width)).toBe(376);
    expect(Number.parseFloat(page.style.paddingLeft)).toBeCloseTo(96 * (376 / 816), 1);
    expect(Number.parseFloat(page.style.minHeight)).toBeCloseTo(1056 * (376 / 816), 1);
  });
});

describe("page breaks handed to docx-preview", () => {
  type Node = { type: string; children?: Node[]; break?: string; text?: string; [key: string]: unknown };
  const t = (text: string): Node => ({ type: "text", text });
  const br = (kind: string): Node => ({ type: "break", break: kind });
  const run = (...children: Node[]): Node => ({ type: "run", children });
  const p = (extra: Record<string, unknown>, ...runs: Node[]): Node => ({
    type: "paragraph",
    children: runs,
    ...extra,
  });
  const breaks = (node: Node): string[] =>
    (node.children ?? []).flatMap((r) =>
      (r.children ?? []).filter((c) => c.type === "break").map((c) => c.break ?? ""),
    );

  it("ends every new-page section with a page break and leaves continuous ones alone", () => {
    const first = p({ sectionProps: { pageSize: { width: 1 } } }, run(t("a")));
    const second = p({ sectionProps: {} }, run(t("b")));
    const body = { type: "document", children: [first, second, p({}, run(t("c")))], props: { type: "continuous" } };
    adjustPageBreaks(body, true);
    expect(breaks(first)).toEqual(["page"]);
    expect(breaks(second)).toEqual([]);
  });

  it("drops saved breaks that would open an empty sheet and keeps the others", () => {
    const afterExplicit = p({}, run(br(SAVED), t("page two")));
    const midParagraph = p({}, run(t("long paragraph"), br(SAVED), t("continued")));
    const atStart = p({}, run(br(SAVED), t("page three")));
    const styled = p({ styleName: "Chapter" }, run(br(SAVED), t("chapter")));
    const body = {
      type: "document",
      children: [p({}, run(t("one"), br("page"))), afterExplicit, midParagraph, atStart, styled],
    };
    adjustPageBreaks(body, true, new Set(["Chapter"]));
    expect(breaks(afterExplicit)).toEqual([]);
    expect(breaks(midParagraph)).toEqual([SAVED]);
    expect(breaks(atStart)).toEqual([SAVED]);
    expect(breaks(styled)).toEqual([]);
  });

  it("removes all saved breaks when they are not wanted", () => {
    const para = p({}, run(t("x"), br(SAVED), t("y")), run(br("page")));
    adjustPageBreaks({ type: "document", children: [para] }, false);
    expect(breaks(para)).toEqual(["page"]);
  });

  it("lets sections without their own header continue the previous one", () => {
    const first = { headerRefs: [{ type: "default", id: "rId1" }], footerRefs: [{ type: "default", id: "rId2" }] };
    const second: Record<string, unknown> = { footerRefs: [{ type: "default", id: "rId3" }] };
    const last: Record<string, unknown> = {};
    const body = { type: "document", children: [p({ sectionProps: first }), p({ sectionProps: second })], props: last };
    inheritHeadersAndFooters(body);
    expect(second.headerRefs).toEqual([{ type: "default", id: "rId1" }]);
    expect(second.footerRefs).toEqual([{ type: "default", id: "rId3" }]);
    expect(last.footerRefs).toEqual([{ type: "default", id: "rId3" }]);
  });

  it("keeps note references in superscript runs from being counted twice", () => {
    const ref: Node = { type: "run", verticalAlign: "sup", children: [{ type: "footnoteReference", id: "1" }] };
    const plain: Node = { type: "run", verticalAlign: "sup", children: [t("2")] };
    unwrapNoteReferenceRuns({ type: "document", children: [p({}, ref, plain)] });
    expect(ref.verticalAlign).toBeUndefined();
    expect(plain.verticalAlign).toBe("sup");
  });

  it("numbers PAGE and NUMPAGES fields per sheet, restarting where a section says so", () => {
    const field = (code: string, ...result: Node[]): Node[] => [
      { type: "run", fieldRun: true, children: [{ type: "complexField", charType: "begin" }] },
      { type: "run", fieldRun: true, children: [{ type: "instruction", text: code }] },
      { type: "run", fieldRun: true, children: [{ type: "complexField", charType: "separate" }] },
      ...result,
      { type: "run", fieldRun: true, children: [{ type: "complexField", charType: "end" }] },
    ];
    const [pageRun, extraRun] = [run(t("1")), run(t("0"))];
    const pagesRun = run(t("9"));
    const footer = p(
      {},
      ...field(" PAGE \\* MERGEFORMAT ", pageRun, extraRun),
      run(t(" / ")),
      ...field("NUMPAGES", pagesRun),
    );
    const front = p({ sectionProps: { pageNumber: { format: "lowerRoman" } } }, run(t("front")));
    const main = p({}, run(t("main")));
    const body = { type: "document", children: [front, main], props: { type: "nextPage", pageNumber: { start: 1 } } };
    const sections = tagPageNumbers(body, [{ rootElement: { type: "footer", children: [footer] } }]);
    expect(extraRun.children).toEqual([]);

    // Sheets as docx-preview lays them out: the front section runs over two sheets.
    const sheet = (block?: Node) => {
      const el = document.createElement("section");
      el.innerHTML = `${block ? `<p class="${block.className}"></p>` : ""}<footer><span class="${pageRun.className}">1</span><span class="${pagesRun.className}">9</span></footer>`;
      return el;
    };
    const sheets = [sheet(front), sheet(front), sheet(main)];
    numberPageFields(sheets, sections);
    expect(sheets.map((s) => s.querySelector("footer")?.textContent)).toEqual(["i3", "ii3", "13"]);
  });

  it("ignores malformed models", () => {
    expect(() => adjustPageBreaks(null, true)).not.toThrow();
    expect(() => adjustPageBreaks({ children: [null, 3, { type: "paragraph", children: "x" }] }, true)).not.toThrow();
    expect(() =>
      inheritHeadersAndFooters({ children: [{ type: "paragraph", sectionProps: 1 }], props: null }),
    ).not.toThrow();
    expect(() => unwrapNoteReferenceRuns("x")).not.toThrow();
    expect(() =>
      applyDefaultParagraphStyle([null, { children: [3] }], [null, { isDefault: true, target: "p" }]),
    ).not.toThrow();
    expect(tagPageNumbers({ children: [null, run({ type: "complexField", charType: "end" })] }, [null, {}])).toEqual(
      [],
    );
  });
});

describe("list markers", () => {
  it("parses counter lists", () => {
    expect(counterPairs("none", 0)).toEqual([]);
    expect(counterPairs("a 2 b", 1)).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });

  it("parses generated content", () => {
    expect(parseContent('counter(n, lower-roman) "." "\\9"')).toEqual([
      { kind: "counter", name: "n", style: "lower-roman" },
      { kind: "text", value: "." },
      { kind: "text", value: "\t" },
    ]);
    expect(parseContent("none")).toBeNull();
    expect(parseContent("attr(title)")).toBeNull();
  });
});

describe("font fallbacks (decisions-v1 F01)", () => {
  it.each([
    ["Calibri", "Carlito"],
    ["Cambria", "Caladea"],
    ["Arial", "Liberation Sans"],
    ["Helvetica", "Liberation Sans"],
    ["Times New Roman", "Liberation Serif"],
    ["Courier New", "Liberation Mono"],
    ["SimSun", "Noto Serif SC"],
    ["Microsoft YaHei", "Noto Sans SC"],
    ["SimHei", "Noto Sans SC"],
    ["PMingLiU", "Noto Serif TC"],
    ["MS Gothic", "Noto Sans JP"],
    ["Batang", "Noto Serif KR"],
  ])("%s falls back to %s first", (font, substitute) => {
    expect(substituteFor(font)).toBe(substitute);
    const stack = fontStack(font).split(", ");
    expect(stack[0]).toMatch(new RegExp(font));
    expect(stack[1]).toMatch(new RegExp(substitute));
  });

  it("maps the Chinese names too", () => {
    expect(fontStack("宋体")).toContain("Noto Serif SC");
    expect(fontStack("微软雅黑")).toContain("Noto Sans SC");
    expect(substituteFor("Some Unknown Serif")).toBe("a serif font");
  });

  it("rebuilds content from its HTML and finds the sheets again", () => {
    const root = document.createElement("div");
    root.innerHTML = "<section><p>one</p></section><section><p>two</p></section><section><p>three</p></section>";
    const [a, b, c] = Array.from(root.querySelectorAll("section"));
    const extra = document.createElement("span");
    extra.textContent = " live";
    a.querySelector("p")?.append(extra);
    const pages = reparseContent(root, [a, c]);
    expect(pages).toHaveLength(2);
    expect(pages[0]).not.toBe(a);
    expect(pages[0].textContent).toBe("one live");
    expect(pages[1].textContent).toBe("three");
    expect(root.querySelectorAll("[data-swl-sheet]")).toHaveLength(0);
    expect(b.isConnected).toBe(false);
    expect(root.querySelectorAll("section")).toHaveLength(3);
  });

  it("extends font lists and finds the primary families", () => {
    expect(withFontFallbacks("Cambria")).toMatch(/^Cambria, Caladea, /);
    expect(withFontFallbacks("Arial, sans-serif")).toBe("Arial, sans-serif");
    expect(withFontFallbacks("var(--docx-minorHAnsi-font)")).toBe("var(--docx-minorHAnsi-font)");
    expect(
      primaryFamilies("p { font-family: 'Times New Roman', serif } :root { --docx-minorHAnsi-font: Calibri; }"),
    ).toEqual(["Times New Roman", "Calibri"]);
  });
});

describe("style clean-up", () => {
  // docx-preview copies w:rFonts names into style sheets unescaped, so a name can inject whole rules.
  const fetching = /url\(\s*['"]?\s*https|image-set\(|@import|\\/i;

  it.each([
    ["image-set with a bare string", ".a{font-family:'a';}*{background-image:image-set('https://t.test/1.png' 1x)}"],
    ["escaped url(", ".b{background:\\75 rl(https://t.test/2.png)}"],
    ["escaped backslash before an escape", ".c{background:\\\\75 rl(https://t.test/3.png)}"],
    ["url( left open at the end", '.d{background:url("https://t.test/4.png"'],
    ["escaped @import", "@\\69mport 'https://t.test/5.css';"],
    ["@import joined around a removed one", "@imp@import 'a';ort 'https://t.test/7.css';"],
  ])("leaves no network fetch in style sheets: %s", (_name, css) => {
    expect(sanitizeCss(css)).not.toMatch(fetching);
  });

  it("keeps inline images and neutralizes fetches in style attributes", () => {
    expect(sanitizeCss(".e{--b:url(data:image/png;base64,AA)}")).toBe(".e{--b:url(data:image/png;base64,AA)}");
    const host = document.createElement("div");
    host.innerHTML = `<p><svg style="background-image:image-set('https://t.test/6.png' 1x)"></svg></p>`;
    sanitizeTree(host);
    expect(host.innerHTML).not.toMatch(fetching);
  });
});

describe("loadDocx rejections", () => {
  it("rejects text input", async () => {
    await expect(loadDocx({ text: "hello" }, ctx)).rejects.toBeInstanceOf(InputError);
  });

  it("rejects oversized input", async () => {
    await expect(loadDocx({ bytes: sample() }, ctx, { maxBytes: 1000 })).rejects.toMatchObject({ code: "too-large" });
  });

  it.each([
    ["a legacy .doc", () => new Uint8Array(LEGACY_DOC), "legacy-doc"],
    ["plain text bytes", () => new TextEncoder().encode("not a document"), "not-docx"],
  ])("rejects %s", async (_label, bytes, code) => {
    const error = await loadDocx({ bytes: bytes() }, ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocxError);
    expect(error).toMatchObject({ code });
  });

  it("leaves no sandbox behind after a failure", async () => {
    await loadDocx({ bytes: new TextEncoder().encode("x") }, ctx).catch(() => undefined);
    expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
  });
});
