import { describe, expect, it } from "vitest";
import { BOLD, Screen } from "../src/ansi";

const E = "\u001b";

function screenOf(data: string, cols = 10, rows = 4): Screen {
  const s = new Screen(cols, rows);
  s.write(data);
  return s;
}

describe("Screen", () => {
  const cases: [string, string, string, number?, number?][] = [
    ["plain text and CRLF", "ab\r\ncd", "ab\ncd"],
    ["carriage return overwrites", "hello\rJ", "Jello"],
    ["backspace moves left", "abc\b\bX", "aXc"],
    ["erase line to end", "abcdef\r\u001b[3C\u001b[K", "abc"],
    ["erase whole line", "abcdef\u001b[2K", ""],
    ["erase line to start", "abcdef\u001b[1Kg", "      g"],
    ["clear screen and home", "one\r\ntwo\u001b[2J\u001b[Hx", "x"],
    ["cursor position", "\u001b[2;3Hz", "\n  z"],
    ["autowrap", "0123456789ab", "0123456789\nab"],
    ["pending wrap at the margin", "0123456789\r\nx", "0123456789\nx"],
    ["scrolls when full", "1\r\n2\r\n3\r\n4\r\n5", "2\n3\n4\n5"],
    ["tab stops", "a\tb", "a       b"],
    ["delete chars", "abcdef\r\u001b[2P", "cdef"],
    ["insert chars", "abc\r\u001b[2@", "  abc"],
    ["wide characters take two cells", "中文!", "中文!"],
    ["combining mark joins the previous cell", "éx", "éx"],
    ["save and restore cursor", "ab\u001b7\r\nzz\u001b8c", "abc\nzz"],
    ["reverse index at top inserts a line", "top\u001b[H\u001bMnew", "new\ntop"],
  ];
  it.each(cases)("%s", (_name, input, expected, cols, rows) => {
    expect(screenOf(input, cols, rows).text()).toBe(expected);
  });

  it("keeps SGR attributes in runs and trims default blanks", () => {
    const s = screenOf(`${E}[1;31mred${E}[0m ok   `);
    const runs = s.runs(0);
    expect(runs[0]).toMatchObject({ text: "red", cols: 3 });
    expect(runs[0]?.attrs.fg).toBe(1);
    expect((runs[0]?.attrs.flags ?? 0) & BOLD).toBe(BOLD);
    expect(runs.map((r) => r.text).join("")).toBe("red ok");
  });

  it("erases with the current background colour", () => {
    const s = screenOf(`${E}[44m${E}[2K`, 4, 1);
    expect(s.runs(0)).toHaveLength(1);
    expect(s.runs(0)[0]?.attrs.bg).toBe(4);
    expect(s.runs(0)[0]?.cols).toBe(4);
  });

  it("tracks the cursor, its visibility and the window title", () => {
    const s = screenOf(`${E}]0;my title\u0007ab${E}[?25l`);
    expect(s.title).toBe("my title");
    expect(s.x).toBe(2);
    expect(s.cursorVisible).toBe(false);
    s.write(`${E}[?25h`);
    expect(s.cursorVisible).toBe(true);
  });

  it("handles the alternate screen minimally and restores the main screen", () => {
    const s = screenOf(`shell$ ${E}[?1049h${E}[2J${E}[Hfull screen app`);
    expect(s.usedAlternate).toBe(true);
    expect(s.text()).toBe("full scree\nn app");
    s.write(`${E}[?1049l`);
    expect(s.text()).toBe("shell$");
  });

  it("bumps row versions only for touched rows", () => {
    const s = screenOf("a\r\nb");
    const v0 = s.rowVersion(0);
    const v1 = s.rowVersion(1);
    s.write("c");
    expect(s.rowVersion(0)).toBe(v0);
    expect(s.rowVersion(1)).toBeGreaterThan(v1);
  });

  it("records usage for window fitting", () => {
    const s = screenOf("abc\r\nde", 20, 10);
    expect(s.maxRow).toBe(1);
    expect(s.maxCol).toBe(2);
    expect(s.wrapped).toBe(false);
    expect(screenOf("0123456789ab").wrapped).toBe(true);
  });

  it("resizes and clamps the cursor", () => {
    const s = screenOf("0123456789\r\nabc");
    s.resize(5, 2);
    expect(s.cols).toBe(5);
    expect(s.text()).toBe("01234\nabc");
    expect(s.x).toBeLessThanOrEqual(4);
  });

  it("ignores scroll-region abuse and stays in bounds", () => {
    const s = screenOf(`${E}[999;999H${E}[999A${E}[999D${E}[5;2r${E}[S${E}[99Mx`);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.y).toBeGreaterThanOrEqual(0);
    expect(s.text()).toContain("x");
  });
});
