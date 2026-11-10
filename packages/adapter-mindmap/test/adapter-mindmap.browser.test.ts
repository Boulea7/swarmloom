import type { Layer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import xmindUrl from "../../../examples/mindmap/loom.xmind?url";
import releasePlan from "../../../examples/mindmap/release-plan.mm?raw";
import { runLoaded } from "../../adapter-terminal/test/harness";
import { mindmapAdapter } from "../src/index";

const ctx = { document, width: 1100, theme: "light" as const };

function overlaps(a: Layer, b: Layer): boolean {
  return (
    a.box.x < b.box.x + b.box.w &&
    b.box.x < a.box.x + a.box.w &&
    a.box.y < b.box.y + b.box.h &&
    b.box.y < a.box.y + a.box.h
  );
}

describe("mindmapAdapter on the examples", () => {
  it("loads the XMind archive by URL and builds root, then branches, then leaves", async () => {
    const loaded = await mindmapAdapter.load({ url: xmindUrl, name: "loom.xmind" }, ctx);
    const { blueprint } = loaded;
    expect(blueprint.source).toMatchObject({ type: "mindmap", title: "Loom overview" });
    expect(blueprint.truncated).toBeUndefined();
    const boxes = blueprint.layers.filter((l) => l.id.endsWith("-box"));
    // Root, 5 branches and 21 deeper topics.
    expect(boxes).toHaveLength(27);
    expect(blueprint.size.w).toBeLessThanOrEqual(1100);
    for (const a of boxes) for (const b of boxes) if (a !== b) expect(overlaps(a, b), `${a.id} ${b.id}`).toBe(false);
    const run = await runLoaded(loaded);
    try {
      const depth = (id: string): number => (blueprint.layers.find((l) => l.id === id)?.meta?.depth as number) ?? -1;
      // Root first, then the branches, then the leaves (priorities grow with depth).
      const depths = run.order.filter((id) => id.endsWith("-box")).map(depth);
      expect(depths[0]).toBe(0);
      expect(depths).toEqual([...depths].sort((a, b) => a - b));
      // Every topic is built after its parent topic.
      for (const l of blueprint.layers) {
        if (!l.parent) continue;
        expect(run.order.indexOf(l.parent), l.id).toBeLessThan(run.order.indexOf(l.id));
      }
      expect(run.host.textContent).toContain("群织");
    } finally {
      run.dispose();
    }
  });

  it("loads the FreeMind map with its side hints", async () => {
    const { blueprint } = await mindmapAdapter.load({ text: releasePlan, name: "release-plan.mm" }, ctx);
    const box = (title: string): Layer | undefined => {
      const text = blueprint.layers.find((l) => l.kind === "text" && l.text === title);
      return blueprint.layers.find((l) => l.id === text?.parent);
    };
    const root = box("Release 0.2") as Layer;
    expect((box("Docs") as Layer).box.x).toBeLessThan(root.box.x);
    expect((box("Adapters") as Layer).box.x).toBeGreaterThan(root.box.x + root.box.w);
    expect(box("Ship it\non a Friday?")).toBeDefined();
    expect(box("Later")?.meta?.folded).toBe(true);
  });
});
