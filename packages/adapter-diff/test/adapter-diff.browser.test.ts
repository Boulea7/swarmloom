import type { CustomLayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import patch from "../../../examples/diff/core-index.patch?raw";
import { runLoaded, WATCHDOG_MS } from "../../adapter-terminal/test/harness";
import { diffAdapter, LINE_TASK, readLineData } from "../src/index";

describe("diffAdapter on the example patch", () => {
  it("loads the format-patch mailbox and builds every review panel", async () => {
    const loaded = await diffAdapter.load(
      { text: patch, name: "core-index.patch" },
      { document, width: 960, theme: "light" },
    );
    const { blueprint } = loaded;
    expect(blueprint.source.title).toBe(
      "chore(adapters): drop unused snapshot-dom dependency from svg and image adapters",
    );
    expect(blueprint.truncated).toBeUndefined();
    const paths = blueprint.layers.filter((l) => l.id.endsWith("-path")).map((l) => (l.kind === "text" ? l.text : ""));
    expect(paths).toEqual([
      "packages/adapter-image/package.json",
      "packages/adapter-svg/package.json",
      "pnpm-lock.yaml",
      "packages/core/src/index.ts",
      "packages/core/test/core.test.ts",
    ]);
    const rows = blueprint.layers.filter((l): l is CustomLayer => l.kind === "custom" && l.task === LINE_TASK);
    const kinds = rows.map((r) => readLineData(r.data)?.kind);
    expect(kinds.filter((k) => k === "add")).toHaveLength(19);
    expect(kinds.filter((k) => k === "del")).toHaveLength(17);
    expect(rows.every((r) => (r.meta as { author?: string }).author === "boulea7")).toBe(true);

    const run = await runLoaded(loaded);
    try {
      for (const [id, ms] of run.taskMs) expect(ms, id).toBeLessThan(WATCHDOG_MS);
      for (const r of rows) expect(run.finished.has(r.id), r.id).toBe(true);
      expect(run.bubbles).toContain("boulea7");
      expect(run.cursors).toContain("pen");
      expect(run.sounds.filter((s) => s === "key").length).toBeGreaterThan(100);
      // Final state: added lines fully typed, removed lines struck and dimmed.
      const added = run.host.querySelectorAll(".sld-add .sld-code");
      expect([...added].some((el) => el.textContent?.includes("createI18n, createPlayer, definePlugin"))).toBe(true);
      const gone = run.host.querySelectorAll(".sld-del.sld-gone");
      expect(gone).toHaveLength(17);
      const strike = gone[0]?.querySelector(".sld-strike") as HTMLElement;
      expect(getComputedStyle(strike).transform).not.toBe("none");
      expect(getComputedStyle(gone[0] as Element).backgroundColor).toBe("rgb(253, 236, 238)");
      const row = run.host.querySelector(".sld-row") as HTMLElement;
      expect(row.getBoundingClientRect().height).toBe(20);
    } finally {
      run.dispose();
    }
  });
});
