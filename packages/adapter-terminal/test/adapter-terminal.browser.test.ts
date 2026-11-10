import type { CustomLayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import session from "../../../examples/terminal/session.cast?raw";
import { STEP_TASK, type TerminalScreenData, terminalAdapter } from "../src/index";
import { runLoaded, WATCHDOG_MS } from "./harness";

describe("terminalAdapter on the example session", () => {
  it("loads into a blueprint and plays every step to the recorded end state", async () => {
    const loaded = await terminalAdapter.load(
      { text: session, name: "session.cast" },
      { document, width: 960, theme: "light" },
    );
    const { blueprint } = loaded;
    expect(blueprint.source).toMatchObject({ type: "terminal", title: "weaver@loom: pnpm test" });
    expect(blueprint.truncated).toBeUndefined();
    const screen = blueprint.layers.find((l) => l.id === "term-screen") as CustomLayer;
    const data = screen.data as TerminalScreenData;
    expect(data.cellW).toBeGreaterThan(4);
    // The window fits the columns the session uses (the recording is 74 wide, no line wraps).
    expect(data.cols).toBeGreaterThanOrEqual(40);
    expect(data.cols).toBeLessThan(74);
    const steps = blueprint.layers.filter((l) => l.kind === "custom" && l.task === STEP_TASK);
    expect(steps.length).toBeGreaterThan(4);
    expect(steps.some((l) => (l.meta as { kind: string }).kind === "input")).toBe(true);

    const run = await runLoaded(loaded);
    try {
      for (const [id, ms] of run.taskMs) expect(ms, id).toBeLessThan(WATCHDOG_MS);
      for (const l of steps) expect(run.finished.has(l.id), l.id).toBe(true);
      // Playback time follows the recording (idle gaps capped at the header's 2 s).
      expect(run.total).toBeGreaterThan(10_000);
      expect(run.total).toBeLessThan(40_000);
      expect(run.sounds.filter((s) => s === "key").length).toBeGreaterThan(20);
      expect(run.bubbles).toContain("typing");
      expect(run.cursors).toContain("ibeam");

      const view = run.host.querySelector('[role="log"]') as HTMLElement;
      expect(view).not.toBeNull();
      const text = view.textContent ?? "";
      expect(text).toContain("pnpm test --filter adapter-terminal");
      expect(text).not.toContain("adaptr");
      expect(text).toContain("131 passed");
      expect(text).toContain("100%");
      expect(text).toContain("#5b5bf7");
      const caret = view.querySelector(".slt-caret") as HTMLElement;
      expect(caret).not.toBeNull();
      // Truecolor backgrounds end up as inline styles.
      expect(view.innerHTML).toContain("background-color:#5b5bf7");
      // Replay: remounting a step resets the screen to that point.
      const first = steps[0] as CustomLayer;
      loaded.plugins?.[0]?.renderers?.[STEP_TASK]?.mount(first, document.createElement("div"), run.stage);
      expect(view.textContent ?? "").not.toContain("131 passed");
    } finally {
      run.dispose();
    }
  });
});
