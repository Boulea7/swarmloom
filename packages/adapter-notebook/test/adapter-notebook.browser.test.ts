import type { ImageLayer, Layer, TextLayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import example from "../../../examples/notebook/loom-tour.ipynb?raw";
import { runLoaded, WATCHDOG_MS } from "../../adapter-terminal/test/harness";
import { notebookAdapter, notebookPalette, RUN_TASK } from "../src/index";

describe("notebookAdapter on the example notebook", () => {
  it("loads into a blueprint and builds every cell: frame, code, run, outputs", async () => {
    const loaded = await notebookAdapter.load(
      { text: example, name: "loom-tour.ipynb" },
      { document, width: 960, theme: "light" },
    );
    const { blueprint } = loaded;
    const byId = new Map<string, Layer>(blueprint.layers.map((l) => [l.id, l]));
    expect(blueprint.truncated).toBeUndefined();

    // Heights come from real layout: cell 1 has six source lines (20 px each, 10 px padding).
    expect(byId.get("nb-1-frame")?.box.h).toBe(6 * 20 + 2 * 10);
    const chart = byId.get("nb-5-out0") as ImageLayer;
    expect(chart.natural).toEqual({ w: 640, h: 260 });
    expect(chart.box.w).toBeLessThanOrEqual(640);
    expect(chart.src.startsWith("data:image/png;base64,")).toBe(true);
    const blocks = blueprint.layers.filter((l) => /-(?:frame|md)$/.test(l.id));
    for (let k = 1; k < blocks.length; k++) {
      const a = blocks[k - 1] as Layer;
      expect((blocks[k] as Layer).box.y, (blocks[k] as Layer).id).toBeGreaterThanOrEqual(a.box.y + a.box.h);
    }

    const run = await runLoaded(loaded);
    try {
      const runs = blueprint.layers.filter((l) => l.kind === "custom" && l.task === RUN_TASK);
      expect(runs.length).toBe(6);
      for (const [id, ms] of run.taskMs) expect(ms, id).toBeLessThan(WATCHDOG_MS);
      for (const l of blueprint.layers) expect(run.finished.has(l.id), l.id).toBe(true);
      expect(run.bubbles).toContain("running");
      expect(run.sounds).toContain("press");
      // Each cell is built frame -> code -> run -> outputs.
      const at = (id: string): number => run.order.indexOf(id);
      for (const i of [1, 2, 4, 5, 6, 7]) {
        expect(at(`nb-${i}-frame`)).toBeLessThan(at(`nb-${i}-code`));
        expect(at(`nb-${i}-code`)).toBeLessThan(at(`nb-${i}-run`));
        expect(at(`nb-${i}-run`)).toBeLessThan(at(`nb-${i}-out0`));
      }

      const pal = notebookPalette("light");
      const prompt = (i: number): HTMLElement => run.stage.el(`nb-${i}-run`) as HTMLElement;
      expect(prompt(1).textContent).toBe("In [1]:");
      expect(prompt(7).textContent).toBe("In [6]:");
      // The error cell settles in the error colour.
      expect(prompt(6).style.color).toBe("rgb(226, 61, 104)");
      expect(pal.promptOut).toBe("#E23D68");

      const html = (id: string): string => (byId.get(id) as TextLayer).html;
      // DataFrame HTML: the table survives, its <style scoped> does not.
      expect(html("nb-4-out0")).toContain("<table");
      expect(html("nb-4-out0")).not.toMatch(/<style|dataframe tbody/);
      // ANSI traceback colours become inline styles; the progress bar keeps only its last frame.
      expect(html("nb-6-out0")).toContain("color:#c8283c");
      expect((byId.get("nb-7-out0") as TextLayer).text).toBe("weaving: 100%|████████| 8/8");
      // Markdown: GFM table and the Chinese cell with a highlighted fence.
      expect(html("nb-3-md")).toContain('<td style="text-align:right">76.1</td>');
      expect((byId.get("nb-8-md") as TextLayer).text).toContain("群织");
      expect(run.host.querySelector('[data-layer="nb-0-md"] h1')?.textContent).toBe("Weaving a notebook");
    } finally {
      run.dispose();
    }
  });
});
