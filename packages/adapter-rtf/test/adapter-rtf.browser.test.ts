import type { AdapterContext } from "@swarmloom/core";
import { afterEach, describe, expect, it } from "vitest";
import letterUrl from "../../../examples/rtf/loom-letter.rtf?url";
import {
  allText,
  fixture,
  images,
  kinds,
  snapshotHtmlForTests,
  wellFormed,
} from "../../adapter-odf/test/support/snapshot";
import { createRtfAdapter } from "../src/index";

const ctx: AdapterContext = { document, width: 1000, theme: "light" };

afterEach(() => {
  expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
});

describe("rtf adapter on examples/rtf", () => {
  it("weaves loom-letter.rtf as two A4 pages with text, a table and a picture", async () => {
    const adapter = createRtfAdapter({ snapshotHtml: await snapshotHtmlForTests() });
    const loaded = await adapter.load({ name: "loom-letter.rtf", bytes: await fixture(letterUrl) }, ctx);
    const bp = loaded.blueprint;
    expect(wellFormed(bp)).toEqual([]);
    expect(bp.source).toMatchObject({ type: "rtf", name: "loom-letter.rtf", title: "Loom letter" });
    const pages = bp.layers.filter((l) => l.role === "page");
    expect(pages).toHaveLength(2);
    expect(pages[0]?.box.w).toBeCloseTo(793.7, 0);
    expect(kinds(bp)).toEqual(expect.arrayContaining(["box", "text", "image"]));
    const text = allText(bp);
    for (const s of [
      "Loom letter",
      "群织让一群光标",
      "繁體中文",
      "织机笔记",
      "Twill 2/2",
      "A field result",
      "Page two",
    ])
      expect(text).toContain(s);
    expect(text).not.toContain("must not appear");
    const pictures = images(bp, "blob:");
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.box.w).toBeCloseTo(96, 0);
    expect(loaded.notes?.[0]).toContain("Calibri -> Carlito");
    expect(loaded.notes?.[0]).toContain("宋体 -> Noto Serif SC");
    expect(loaded.notes).toContain("Headers and footers are not shown.");
    loaded.dispose?.();
  }, 30_000);
});
