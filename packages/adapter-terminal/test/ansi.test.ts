import { describe, expect, it } from "vitest";
import {
  type AnsiHandler,
  AnsiParser,
  ansiToHtml,
  applySgr,
  attrsCss,
  BOLD,
  charWidth,
  colorCss,
  DEFAULT_COLOR,
  DIM,
  INVERSE,
  ITALIC,
  LOOM_INK,
  LOOM_PAPER,
  PLAIN,
  parseParams,
  RGB_FLAG,
  STRIKE,
  stringWidth,
  stripAnsi,
  themeFrom,
  UNDERLINE,
  xterm256,
} from "../src/ansi";

const rgb = (r: number, g: number, b: number): number => RGB_FLAG | (r << 16) | (g << 8) | b;

describe("applySgr", () => {
  const cases: [string, string, { fg?: number; bg?: number; flags?: number }][] = [
    ["reset", "0", { fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, flags: 0 }],
    ["empty means reset", "", { flags: 0 }],
    ["bold", "1", { flags: BOLD }],
    ["dim + italic + underline", "2;3;4", { flags: DIM | ITALIC | UNDERLINE }],
    ["inverse + strike", "7;9", { flags: INVERSE | STRIKE }],
    ["fg red", "31", { fg: 1 }],
    ["bg green", "42", { bg: 2 }],
    ["bright fg", "91", { fg: 9 }],
    ["bright bg", "107", { bg: 15 }],
    ["256 fg", "38;5;196", { fg: 196 }],
    ["256 bg", "48;5;17", { bg: 17 }],
    ["truecolor fg", "38;2;255;79;123", { fg: rgb(255, 79, 123) }],
    ["truecolor bg", "48;2;1;2;3", { bg: rgb(1, 2, 3) }],
    ["colon 256", "38:5:42", { fg: 42 }],
    ["colon truecolor with colorspace", "38:2::10:20:30", { fg: rgb(10, 20, 30) }],
    ["bold then fg in one", "1;33", { fg: 3, flags: BOLD }],
    ["default fg/bg", "31;41;39;49", { fg: DEFAULT_COLOR, bg: DEFAULT_COLOR }],
    ["256 out of range ignored", "38;5;300", { fg: DEFAULT_COLOR }],
    ["underline colour skipped", "58;5;3;4", { flags: UNDERLINE, fg: DEFAULT_COLOR }],
  ];
  it.each(cases)("%s (%s)", (_name, params, expected) => {
    const out = applySgr(PLAIN, params);
    if (expected.fg !== undefined) expect(out.fg).toBe(expected.fg);
    if (expected.bg !== undefined) expect(out.bg).toBe(expected.bg);
    if (expected.flags !== undefined) expect(out.flags).toBe(expected.flags);
  });

  it("turns attributes off one by one", () => {
    let a = applySgr(PLAIN, "1;2;3;4;7;9");
    a = applySgr(a, "22");
    expect(a.flags & (BOLD | DIM)).toBe(0);
    a = applySgr(a, "23;24;27;29");
    expect(a.flags).toBe(0);
  });

  it("returns the same object when nothing changes", () => {
    const bold = applySgr(PLAIN, "1");
    expect(applySgr(bold, "1")).toBe(bold);
    expect(applySgr(PLAIN, "0")).toBe(PLAIN);
  });

  it("caps parameters and treats empty fields as defaults", () => {
    expect(parseParams("1;;3")).toEqual([[1], [-1], [3]]);
    expect(parseParams(Array(200).fill("1").join(";")).length).toBe(64);
  });
});

describe("colours", () => {
  it("maps the 256-colour cube and grey ramp", () => {
    expect(xterm256(16)).toBe(0x000000);
    expect(xterm256(196)).toBe(0xff0000);
    expect(xterm256(231)).toBe(0xffffff);
    expect(xterm256(232)).toBe(0x080808);
    expect(xterm256(255)).toBe(0xeeeeee);
    expect(xterm256(7)).toBe(-1);
  });
  it("renders CSS with inverse, dim and hidden", () => {
    expect(colorCss(DEFAULT_COLOR, LOOM_INK)).toBeNull();
    expect(colorCss(1, LOOM_INK)).toBe(LOOM_INK.palette[1]);
    expect(colorCss(rgb(255, 0, 16), LOOM_INK)).toBe("#ff0010");
    const inv = attrsCss(applySgr(PLAIN, "7"), LOOM_INK);
    expect(inv).toContain(`color:${LOOM_INK.bg}`);
    expect(inv).toContain(`background-color:${LOOM_INK.fg}`);
    expect(attrsCss(applySgr(PLAIN, "1;4;9"), LOOM_INK)).toMatch(/font-weight:700.*underline line-through/);
    expect(attrsCss(applySgr(PLAIN, "8"), LOOM_INK)).toContain("transparent");
    expect(attrsCss(PLAIN, LOOM_INK)).toBe("");
  });
  it("reads asciinema themes and rejects bad ones", () => {
    const t = themeFrom({ fg: "#ffffff", bg: "#000", palette: Array(8).fill("#123456").join(":") });
    expect(t.fg).toBe("#ffffff");
    expect(t.bg).toBe("#000000");
    expect(t.palette[0]).toBe("#123456");
    expect(t.palette[8]).toBe("#123456");
    expect(t.palette).toHaveLength(16);
    expect(themeFrom({ fg: "red", palette: "x" })).toEqual(LOOM_INK);
    expect(LOOM_PAPER.palette).toHaveLength(16);
  });
});

describe("AnsiParser", () => {
  function record(input: string | string[]): string[] {
    const log: string[] = [];
    const h: AnsiHandler = {
      print: (t) => log.push(`p:${t}`),
      control: (c) => log.push(`c:${c}`),
      csi: (priv, params, inter, final) => log.push(`csi:${priv}|${params}|${inter}|${final}`),
      esc: (inter, final) => log.push(`esc:${inter}|${final}`),
      osc: (data) => log.push(`osc:${data}`),
    };
    const p = new AnsiParser();
    for (const chunk of Array.isArray(input) ? input : [input]) p.feed(chunk, h);
    return log;
  }
  it("splits text, controls and sequences", () => {
    expect(record("ab\r\n\u001b[1;31mc\u001b[?25l\u001b7")).toEqual([
      "p:ab",
      "c:13",
      "c:10",
      "csi:|1;31||m",
      "p:c",
      "csi:?|25||l",
      "esc:|7",
    ]);
  });
  it("keeps state across chunks", () => {
    expect(record(["x\u001b[", "38;5;", "9m", "y"])).toEqual(["p:x", "csi:|38;5;9||m", "p:y"]);
  });
  it("reads OSC titles ended by BEL or ST and C1 CSI", () => {
    expect(record("\u001b]0;hello\u0007\u001b]2;there\u001b\\\u009b2J")).toEqual([
      "osc:0;hello",
      "osc:2;there",
      "csi:|2||J",
    ]);
  });
  it("drops oversized sequences instead of buffering them", () => {
    const log = record(`\u001b[${"1;".repeat(400)}mok`);
    expect(log.at(-1)).toBe("p:ok");
    expect(log.some((l) => l.startsWith("csi:"))).toBe(false);
  });
});

describe("widths and log HTML", () => {
  it("measures wide and combining characters", () => {
    expect(charWidth("a".codePointAt(0) as number)).toBe(1);
    expect(charWidth("中".codePointAt(0) as number)).toBe(2);
    expect(charWidth(0x0301)).toBe(0);
    expect(stringWidth("中文ab")).toBe(6);
  });
  it("strips escapes and applies carriage returns like a log", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m plain")).toBe("red plain");
    expect(stripAnsi("10%\r50%\r100%\n")).toBe("100%\n");
    expect(stripAnsi("abc\b\bX")).toBe("aXc");
    expect(stripAnsi("progress 99\r\u001b[Kdone")).toBe("done");
  });
  it("escapes HTML and emits styled spans", () => {
    const html = ansiToHtml("<b>\u001b[1;32mok\u001b[0m & more", LOOM_PAPER);
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp;");
    expect(html).toMatch(/<span style="[^"]*color:#1f8a52[^"]*font-weight:700[^"]*">ok<\/span>/);
    expect(html).not.toContain("\u001b");
  });
});
