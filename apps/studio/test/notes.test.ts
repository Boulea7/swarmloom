import { expect, it } from "vitest";
import { createStudioI18n } from "../src/i18n";
import { en } from "../src/i18n/messages/en";
import { zhCN } from "../src/i18n/messages/zh-CN";
import { localizeNote } from "../src/notes";

it("words a font note with a crafted long font name without stalling", () => {
  // A DOCX font name is kept as written; a long run of spaces made the old pair pattern quadratic
  // (about 10 s for this name, minutes for longer ones) on Studio's main thread.
  const name = `A${" ".repeat(100_000)}x`;
  const note = `Fonts not installed on this device are shown with look-alikes (or the closest installed font): ${name} → a serif font.`;
  const start = performance.now();
  const text = localizeNote(note, createStudioI18n("en", en, null));
  expect(performance.now() - start).toBeLessThan(1000);
  expect(text).toBe(`Fonts missing on this device are shown with similar ones: ${name} → serif.`);
});

it.each([
  // EPUB: the outline keeps the book's own entries.
  ["Outline: Warp and Weft / Counting threads (+3 more).", "目录：Warp and Weft / Counting threads（另有 3 项）。"],
  ["Scripts in the book were not run.", "书中的脚本没有运行。"],
  [
    "2 image(s) could not be shown (missing, linked externally or not a supported type).",
    "有 2 张图片无法显示（缺失、链接到外部或格式不受支持）。",
  ],
  // OpenDocument.
  [
    "1 embedded object(s) (charts, formulas, OLE) are shown as placeholders.",
    "有 1 个嵌入对象（图表、公式、OLE）以占位框显示。",
  ],
  // DOCX: the simplified view's parts and the renderer's error text, which stays as written.
  [
    "The simplified view leaves out 2 pictures, headers and footers, footnotes.",
    "简化视图省略了：2 张图片、页眉页脚和脚注。",
  ],
  [
    "The full renderer could not lay out this document (bad numbering), so a simplified view is shown.",
    "完整渲染器无法排版这份文档（bad numbering），因此显示简化视图。",
  ],
  // A part Studio does not know keeps the whole note in English rather than half translating it.
  ["The simplified view leaves out charts.", "The simplified view leaves out charts."],
])("words the EPUB, OpenDocument and DOCX note %j in the UI language", (note, expected) => {
  expect(localizeNote(note, createStudioI18n("zh-CN", zhCN, null))).toBe(expected);
});
