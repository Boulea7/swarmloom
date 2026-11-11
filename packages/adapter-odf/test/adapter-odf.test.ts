/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterContext, Blueprint } from "@swarmloom/core";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createOdfAdapter, sniffOdf } from "../src/index";
import type { SnapshotHtml } from "../src/kit/snapshot";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => new Uint8Array(readFileSync(join(ROOT, rel)));
const ctx: AdapterContext = { document, width: 1000, theme: "light" };

/** Loads with a snapshot stand-in that keeps the generated HTML and CSS for inspection. */
async function render(bytes: Uint8Array, name: string) {
  let html = "";
  let css = "";
  const capture: SnapshotHtml = async (h, o) => {
    html = h;
    css = o.css ?? "";
    const bp: Blueprint = {
      version: 1,
      source: { type: "html" },
      size: { w: o.width, h: 100 },
      background: "#fff",
      layers: [],
    };
    return bp;
  };
  const loaded = await createOdfAdapter({ snapshotHtml: capture }).load({ name, bytes }, ctx);
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return { loaded, dom, css, html };
}

const MIME_ODT = "application/vnd.oasis.opendocument.text";
const odfZip = (files: Record<string, string>, mime = MIME_ODT) =>
  zipSync({
    mimetype: [strToU8(mime), { level: 0 }],
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  });

const FLAT = `<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:mimetype="${MIME_ODT}"><office:automatic-styles><style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">Flat</text:h><text:p>a<text:s text:c="2"/><text:span text:style-name="B">b</text:span></text:p></office:text></office:body></office:document>`;

describe("sniffOdf", () => {
  it.each([
    ["examples/odf/report.odt", true],
    ["examples/odf/budget.ods", true],
    ["examples/odf/deck.odp", true],
    ["examples/epub/loom-notes.epub", false],
    ["examples/ofd/loom-receipt.ofd", false],
  ])("%s -> %s", (rel, expected) => {
    expect(sniffOdf(read(rel).subarray(0, 4096))).toBe(expected);
  });

  it("recognises flat XML and ignores other XML", () => {
    expect(sniffOdf(strToU8(FLAT))).toBe(true);
    expect(sniffOdf(strToU8('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(false);
  });
});

describe("odf structure", () => {
  it("turns report.odt into two A4 pages with headings, lists, a merged table, a footnote and the footer", async () => {
    const { dom, css, loaded } = await render(read("examples/odf/report.odt"), "report.odt");
    const pages = dom.querySelectorAll("section.sl-sheet");
    expect(pages).toHaveLength(2);
    expect(pages[0]?.getAttribute("style")).toContain("width:793.7px");
    expect(dom.querySelector("h1")?.textContent).toBe("Field notes from the loom");
    expect(dom.querySelectorAll("ul.odf-list li")).toHaveLength(4);
    expect(dom.querySelector("ol.odf-list")?.children).toHaveLength(3);
    expect(dom.querySelectorAll("table.odf-table tr")).toHaveLength(4);
    expect(dom.querySelector('td[colspan="3"]')?.textContent).toContain("threads per centimetre");
    expect(dom.querySelector(".odf-notes")?.textContent).toContain("visual replay");
    expect(pages[1]?.querySelector("footer")?.textContent).toBe("Page 2 of 2");
    expect(dom.querySelector("img.odf-img")).not.toBeNull();
    // Styles come from styles.xml (Heading 2 colour) and automatic styles (bold span).
    expect(css).toMatch(/color:#5B5BF7/i);
    expect(css).toContain("font-weight:bold");
    expect(css).toContain("Calibri, Carlito, ");
    // Without canvas metrics font availability is unknown, so no substitution is claimed.
    expect(loaded.notes?.join(" ") ?? "").not.toContain("Carlito");
    loaded.dispose?.();
  });

  it("draws budget.ods with saved values, merged cells and fills, ignoring filler rows and columns", async () => {
    const { dom, css } = await render(read("examples/odf/budget.ods"), "budget.ods");
    const sheets = dom.querySelectorAll("section.sl-sheet");
    expect(sheets).toHaveLength(2);
    expect(sheets[0]?.querySelector(".ods-title")?.textContent).toBe("Loom budget");
    const cells = [...(sheets[0]?.querySelectorAll(".ods-cell") ?? [])].map((c) => c.textContent);
    expect(cells).toEqual(expect.arrayContaining(["Loom budget, first half", "2,252", "12.5%", "织工（光标）"]));
    // 4 used columns and 8 used rows: one header per column and row.
    expect(sheets[0]?.querySelectorAll(".ods-head")).toHaveLength(4 + 8);
    expect(css).toMatch(/background-color:#5B5BF7/i);
  });

  it("places deck.odp frames and shapes on 16:9 slides and drops master placeholders", async () => {
    const { dom } = await render(read("examples/odf/deck.odp"), "deck.odp");
    const slides = dom.querySelectorAll("section.sl-sheet");
    expect(slides).toHaveLength(2);
    expect(slides[0]?.getAttribute("style")).toContain("background:#101028");
    expect(slides[1]?.querySelector(".odp-frame")?.textContent).toBe("How the loom works");
    expect(slides[0]?.querySelector("ellipse")).not.toBeNull();
    expect(slides[0]?.querySelector("polygon")).not.toBeNull();
    // The master's footer bar is drawn on every slide; its empty title placeholder is not.
    expect(slides[1]?.querySelectorAll(".odp-shape rect").length).toBeGreaterThanOrEqual(2);
    expect(slides[1]?.querySelector('[style*="matrix("]')?.textContent).toBe("Weft");
  });

  it("reads flat XML documents", async () => {
    const { dom } = await render(strToU8(FLAT), "flat.fodt");
    expect(dom.querySelector("h1")?.textContent).toBe("Flat");
    expect(dom.querySelector("p")?.textContent).toBe("a  b");
  });
});

describe("odf rejections", () => {
  const adapter = createOdfAdapter();
  it("refuses a malformed zip", async () => {
    await expect(adapter.load({ bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]) }, ctx)).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it("refuses password-protected packages", async () => {
    const manifest = `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME_ODT}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data manifest:checksum-type="SHA1/1K" manifest:checksum="x"/></manifest:file-entry></manifest:manifest>`;
    const bytes = odfZip({ "content.xml": "\u0000garbage", "META-INF/manifest.xml": manifest });
    await expect(adapter.load({ bytes }, ctx)).rejects.toMatchObject({ code: "encrypted" });
  });

  it("refuses entity declarations and other document classes", async () => {
    const dtd = odfZip({ "content.xml": '<!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>' });
    await expect(adapter.load({ bytes: dtd }, ctx)).rejects.toMatchObject({ code: "malformed" });
    const formula = odfZip({ "content.xml": "<x/>" }, "application/vnd.oasis.opendocument.formula");
    await expect(adapter.load({ bytes: formula }, ctx)).rejects.toMatchObject({ code: "unsupported" });
  });
});
