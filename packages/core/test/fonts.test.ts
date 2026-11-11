import { describe, expect, it } from "vitest";
import { cleanFontFamily, FONT_FALLBACKS, formatFontFamily, resolveFontFamily } from "../src/index";

describe("FONT_FALLBACKS (decisions-v1 F01)", () => {
  it.each([
    ["Calibri", "Carlito", "sans-serif"],
    ["Cambria", "Caladea", "serif"],
    ["Arial", "Liberation Sans", "sans-serif"],
    ["Helvetica", "Liberation Sans", "sans-serif"],
    ["Times New Roman", "Liberation Serif", "serif"],
    ["Courier New", "Liberation Mono", "monospace"],
    ["宋体", "Noto Serif SC", "serif"],
    ["SimSun", "Noto Serif SC", "serif"],
    ["微软雅黑", "Noto Sans SC", "sans-serif"],
    ["黑体", "Noto Sans SC", "sans-serif"],
    ["新細明體", "Noto Serif TC", "serif"],
    ["Microsoft JhengHei", "Noto Sans TC", "sans-serif"],
    ["ＭＳ 明朝", "Noto Serif JP", "serif"],
    ["Meiryo", "Noto Sans JP", "sans-serif"],
    ["바탕", "Noto Serif KR", "serif"],
    ["Malgun Gothic", "Noto Sans KR", "sans-serif"],
  ])("%s -> %s", (face, substitute, generic) => {
    const { family, substituted } = resolveFontFamily(face);
    expect(substituted).toBe(substitute);
    expect(FONT_FALLBACKS[face.toLowerCase()]?.generic).toBe(generic);
    const names = family.split(", ");
    // The document's face comes first, so an installed copy wins; the generic family ends the stack.
    expect(names[0]?.replace(/"/g, "")).toBe(face);
    expect(names).toContain(substitute.includes(" ") ? `"${substitute}"` : substitute);
    expect(names.at(-1)).toBe(generic);
  });

  it("keeps the same face under its other name ahead of the substitute", () => {
    expect(resolveFontFamily("微软雅黑").family).toMatch(/^"微软雅黑", "Microsoft YaHei", "Noto Sans SC", /);
    expect(resolveFontFamily("Calibri").family).toMatch(/^Calibri, Carlito, "Segoe UI", /);
  });
});

describe("resolveFontFamily", () => {
  it("stacks every face of a run in order and reports the first face's substitute", () => {
    const run = resolveFontFamily(["Calibri", "宋体"]);
    expect(run.substituted).toBe("Carlito");
    const names = run.family.split(", ");
    expect(names.indexOf('"宋体"')).toBeGreaterThan(names.indexOf("Carlito"));
    expect(names.at(-1)).toBe("sans-serif");
  });

  it("guesses or takes the generic family of unknown faces and reports nothing", () => {
    expect(resolveFontFamily("Fira Code")).toEqual({
      family: '"Fira Code", "Noto Sans Mono CJK SC", "Noto Sans SC", monospace',
    });
    expect(resolveFontFamily("Brand Display", "serif").family).toMatch(/^"Brand Display", .*, serif$/);
    expect(resolveFontFamily("Segoe UI").substituted).toBeUndefined();
  });

  it("cannot be used to break out of a CSS declaration", () => {
    const { family } = resolveFontFamily('Evil"; background:url(x) }, serif');
    expect(family.startsWith('"Evil background:urlx serif", ')).toBe(true);
    expect(family).not.toMatch(/[;{}()]/);
    expect(cleanFontFamily(" a\u0000\n  b ")).toBe("a b");
    // A face named like a CSS keyword is quoted, so it is not read as the generic family.
    expect(formatFontFamily(["FangSong", "Inter", "Inter"], "serif")).toBe('"FangSong", Inter, serif');
  });
});
