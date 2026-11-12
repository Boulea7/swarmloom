import type { CustomLayer } from "@swarmloom/core";
import { load } from "@swarmloom/formats";
import { describe, expect, it } from "vitest";
import { renderFormats } from "../src/render/page";
import type { TerminalFont } from "../src/render/protocol";

const cast = '{"version":2,"width":40,"height":4}\n[0.1,"o","$ ls\\r\\nnotes.md\\r\\n"]';

/** Font size of a short session loaded for a 1280x720 frame. */
async function fontSize(terminalFont?: TerminalFont): Promise<number> {
  const ctx = { document, width: 1280, theme: "dark" as const };
  const { blueprint } = await load({ name: "a.cast", text: cast }, ctx, { registry: renderFormats(720, terminalFont) });
  const screen = blueprint.layers.find((l): l is CustomLayer => l.id === "term-screen");
  return (screen?.data as { fontSize?: number } | undefined)?.fontSize ?? 0;
}

describe("render page formats", () => {
  it("grows the font of terminal recordings only with terminalFont fill", async () => {
    expect(await fontSize()).toBe(14);
    expect(await fontSize("fill")).toBeGreaterThan(40);
  });
});
