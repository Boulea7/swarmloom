import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ZipArchive } from "../src/shared/zip";
import { readOds } from "../src/sheet/ods";

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
].join(" ");

function ods(body: string): ZipArchive {
  const content = `<office:document-content ${NS}><office:automatic-styles>
    <style:style style:name="ce1" style:family="table-cell"><style:text-properties fo:font-weight="bold"/></style:style>
    <style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="1in"/></style:style>
  </office:automatic-styles><office:body><office:spreadsheet>${body}</office:spreadsheet></office:body></office:document-content>`;
  return ZipArchive.open(
    zipSync({
      mimetype: strToU8("application/vnd.oasis.opendocument.spreadsheet"),
      "content.xml": strToU8(content),
    }),
  );
}

describe("readOds", () => {
  it("reads values, spans and styles without expanding filler repeats", () => {
    const wb = readOds(
      ods(`<table:table table:name="Data">
        <table:table-column table:style-name="co1" table:number-columns-repeated="16384"/>
        <table:table-row>
          <table:table-cell table:style-name="ce1" table:number-columns-spanned="2"><text:p>Title<text:s text:c="2"/>x</text:p></table:table-cell>
          <table:covered-table-cell/>
          <table:table-cell table:number-columns-repeated="16382"/>
        </table:table-row>
        <table:table-row>
          <table:table-cell office:value-type="float" office:value="1234.5"><text:p>1,234.50</text:p></table:table-cell>
          <table:table-cell table:number-columns-repeated="2"><text:p>dup</text:p></table:table-cell>
        </table:table-row>
        <table:table-row table:number-rows-repeated="1048574"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
      </table:table>`),
      { maxRows: 200, maxCols: 30, maxSheets: 3 },
    );
    const sheet = wb.sheets[0];
    expect(sheet?.name).toBe("Data");
    expect(sheet?.rows).toBe(2);
    expect(sheet?.cols).toBe(3);
    expect(sheet?.colWidths).toEqual([96, 96, 96]);
    expect(sheet?.cells.map((c) => [c.row, c.col, c.text, c.kind])).toEqual([
      [0, 0, "Title  x", "string"],
      [1, 0, "1,234.50", "number"],
      [1, 1, "dup", "string"],
      [1, 2, "dup", "string"],
    ]);
    expect(sheet?.cells[0]?.style?.bold).toBe(true);
    expect(sheet?.merges).toEqual([{ r0: 0, c0: 0, r1: 0, c1: 1 }]);
    expect(sheet?.droppedCells).toBe(0);
  });

  it("rejects a package without content", () => {
    const zip = ZipArchive.open(zipSync({ mimetype: strToU8("application/vnd.oasis.opendocument.spreadsheet") }));
    expect(() => readOds(zip, { maxRows: 10, maxCols: 10, maxSheets: 1 })).toThrow(/content\.xml/);
  });
});
