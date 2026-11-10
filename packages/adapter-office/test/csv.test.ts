import { describe, expect, it } from "vitest";
import { decodeText, parseCsv, sniffDelimiter } from "../src/sheet/csv";

describe("parseCsv", () => {
  it.each<[string, string, string[][]]>([
    [
      "plain",
      "a,b,c\n1,2,3",
      [
        ["a", "b", "c"],
        ["1", "2", "3"],
      ],
    ],
    [
      "quoted delimiter",
      'name,note\nAda,"x, y"',
      [
        ["name", "note"],
        ["Ada", "x, y"],
      ],
    ],
    ["escaped quotes", 'q\n"say ""hi"""', [["q"], ['say "hi"']]],
    [
      "newline inside quotes",
      'a,b\n"line 1\nline 2",z',
      [
        ["a", "b"],
        ["line 1\nline 2", "z"],
      ],
    ],
    [
      "CRLF and lone CR",
      "a,b\r\n1,2\r3,4\r\n",
      [
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ],
    ],
    [
      "blank lines skipped",
      "a,b\n\n1,2\n\n",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "trailing delimiter",
      "a,b,\n1,2,",
      [
        ["a", "b", ""],
        ["1", "2", ""],
      ],
    ],
    [
      "empty fields kept",
      "a,,c\n,,",
      [
        ["a", "", "c"],
        ["", "", ""],
      ],
    ],
    [
      "BOM character dropped",
      "\uFEFFid,v\n1,2",
      [
        ["id", "v"],
        ["1", "2"],
      ],
    ],
    [
      "text after closing quote kept",
      'a,b\n"x"y,2',
      [
        ["a", "b"],
        ["xy", "2"],
      ],
    ],
  ])("%s", (_name, text, rows) => {
    const result = parseCsv(text, { delimiter: "," });
    expect(result.rows).toEqual(rows);
    expect(result.unterminatedQuote).toBe(false);
  });

  it("runs an unterminated quote to the end of the input", () => {
    const result = parseCsv('a,b\n1,"open\nstill open', { delimiter: "," });
    expect(result.rows).toEqual([
      ["a", "b"],
      ["1", "open\nstill open"],
    ]);
    expect(result.unterminatedQuote).toBe(true);
  });

  it("keeps at most maxRows x maxCols and counts the rest", () => {
    const text = "a,b,c\n1,2,3\n4,5,6\n7,,9";
    const result = parseCsv(text, { delimiter: ",", maxRows: 2, maxCols: 2 });
    expect(result.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(result.totalRows).toBe(4);
    expect(result.totalCols).toBe(3);
    // c, 3 (cut columns) + 4, 5, 6, 7, 9 (cut rows); empty fields are not counted.
    expect(result.droppedFields).toBe(7);
  });

  it("rejects delimiters that cannot work", () => {
    expect(() => parseCsv("a", { delimiter: '"' })).toThrow(RangeError);
    expect(() => parseCsv("a", { delimiter: ";;" })).toThrow(RangeError);
  });
});

describe("sniffDelimiter", () => {
  it.each<[string, string, string]>([
    ["comma", "a,b,c\n1,2,3\n4,5,6", ","],
    ["semicolon with decimal commas", "name;price;qty\nTea;3,50;2\nCake;4,25;1", ";"],
    ["tab", "a\tb\tc\n1\t2\t3", "\t"],
    ["pipe", "a|b\n1|2\n3|4", "|"],
    ["quoted commas do not count", 'a;b\n"x, y, z";2\n"p, q";3', ";"],
    ["single column falls back to comma", "alpha\nbeta", ","],
  ])("%s", (_name, text, expected) => {
    expect(sniffDelimiter(text)).toBe(expected);
  });

  it("lets the preferred delimiter win ties", () => {
    expect(sniffDelimiter("a\tb,c\n1\t2,3", "\t")).toBe("\t");
    expect(sniffDelimiter("a\tb,c\n1\t2,3")).toBe(",");
  });
});

describe("decodeText", () => {
  const utf8 = (s: string) => new TextEncoder().encode(s);

  it("strips a UTF-8 byte order mark", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Zoë,1")]))).toBe("Zoë,1");
  });

  it("decodes UTF-16 LE with a byte order mark", () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]))).toBe("a,b");
  });

  it("falls back to Windows-1252 for invalid UTF-8", () => {
    // 0xE9 is "e acute" in Windows-1252 and an invalid lone byte in UTF-8.
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });
});
