import type { Blueprint, TextLayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import swarm from "../../../examples/code/swarm.ts?raw";
import { codeAdapter } from "../src/index";

const LINES = swarm.replace(/\n$/, "").split("\n");

function texts(bp: Blueprint, role: string): TextLayer[] {
  return bp.layers.filter((l): l is TextLayer => l.kind === "text" && l.role === role);
}

describe("code example in Chromium", () => {
  it("swarm.ts becomes an editor panel with one typed layer per non-blank line", async () => {
    const t0 = performance.now();
    const ctx = { document, width: 1100, theme: "dark" as const };
    const { blueprint, warnings } = await codeAdapter.load({ name: "swarm.ts", text: swarm }, ctx);
    expect(warnings).toEqual([]);
    expect(blueprint.source).toMatchObject({ type: "code", name: "swarm.ts" });
    expect(blueprint.layers.find((l) => l.id === "panel")?.meta?.language).toBe("typescript");

    const numbers = texts(blueprint, "line-number");
    const code = texts(blueprint, "code");
    expect(numbers).toHaveLength(LINES.length);
    expect(code).toHaveLength(LINES.filter((l) => l.trim() !== "").length);
    expect(code.every((l) => l.reveal === "type")).toBe(true);
    expect(code.map((l) => l.text)).toContain(
      "export function createSwarm(count: number, w: number, h: number, seed = 1): Cursor[] {",
    );

    // Highlighting really ran: keywords and strings carry token colours.
    const tokens = code.reduce((n, l) => n + (l.html.match(/<span style=/g)?.length ?? 0), 0);
    expect(tokens).toBeGreaterThan(60);

    const fontSize = code[0]?.fontSize ?? 0;
    expect(fontSize).toBeGreaterThanOrEqual(10);
    expect(fontSize).toBeLessThanOrEqual(15);
    const panel = blueprint.layers.find((l) => l.id === "panel");
    for (const layer of blueprint.layers) {
      const box = layer.clip ?? layer.box;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual((panel?.box.x ?? 0) + (panel?.box.w ?? 0) + 0.5);
    }
    expect(blueprint.size.h).toBeGreaterThan(LINES.length * fontSize);
    // Build order: indent guides, then the code, then the line numbers.
    const guide = blueprint.layers.find((l) => l.id.startsWith("indent-"));
    expect([guide?.priority, code[0]?.priority, numbers[0]?.priority]).toEqual([1, 2, 3]);

    const again = await codeAdapter.load({ name: "swarm.ts", text: swarm }, ctx);
    expect(again.blueprint).toEqual(blueprint);
    expect(
      performance
        .getEntriesByType("resource")
        .filter((e) => e.startTime >= t0 && new URL(e.name).origin !== location.origin),
    ).toEqual([]);
  });
});
