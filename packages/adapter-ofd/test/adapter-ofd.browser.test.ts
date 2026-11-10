import type { AdapterContext } from "@swarmloom/core";
import { afterEach, describe, expect, it } from "vitest";
import receiptUrl from "../../../examples/ofd/loom-receipt.ofd?url";
import {
  allText,
  fixture,
  images,
  kinds,
  snapshotHtmlForTests,
  vectors,
  wellFormed,
} from "../../adapter-odf/test/support/snapshot";
import { createOfdAdapter } from "../src/index";

const ctx: AdapterContext = { document, width: 1000, theme: "light" };

afterEach(() => {
  expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
});

describe("ofd adapter on examples/ofd", () => {
  it("weaves loom-receipt.ofd as two 210 x 148 mm pages of text, paths and an image", async () => {
    const adapter = createOfdAdapter({ snapshotHtml: await snapshotHtmlForTests() });
    const loaded = await adapter.load({ name: "loom-receipt.ofd", bytes: await fixture(receiptUrl) }, ctx);
    const bp = loaded.blueprint;
    expect(wellFormed(bp)).toEqual([]);
    expect(bp.source).toMatchObject({ type: "ofd", name: "loom-receipt.ofd", title: "织机工坊收据" });
    const pages = bp.layers.filter((l) => l.role === "page");
    expect(pages).toHaveLength(2);
    expect(pages[0]?.box.w).toBeCloseTo(793.7, 0);
    expect(pages[0]?.box.h).toBeCloseTo(559.4, 0);
    expect(kinds(bp)).toEqual(expect.arrayContaining(["box", "text", "image"]));
    expect(vectors(bp).length).toBeGreaterThan(3);
    const text = allText(bp);
    for (const s of ["收据", "Receipt No. 2026-0001", "合计：184.80 元", "已付款", "SwarmLoom 织机工坊", "附注 Notes"])
      expect(text).toContain(s);
    // DeltaX places glyphs: five 2.4 mm advances, then the natural width of the last digit.
    const amount = bp.layers.find((l) => l.kind === "text" && "text" in l && l.text === "120.00");
    expect(amount?.box.w ?? 0).toBeGreaterThan(5 * 2.4 * (96 / 25.4));
    expect(amount?.box.w ?? 0).toBeLessThan(6 * 2.4 * (96 / 25.4) + 2);
    const pictures = images(bp, "blob:");
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.box.w).toBeCloseTo(36 * (96 / 25.4), 0);
    const notes = loaded.notes?.join(" ") ?? "";
    for (const s of ["SimSun -> Noto Serif SC", "KaiTi -> Noto Serif SC", "SimHei -> Noto Sans SC"])
      expect(notes).toContain(s);
    loaded.dispose?.();
  }, 30_000);
});
