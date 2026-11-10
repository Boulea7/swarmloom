import { describe, expect, it } from "vitest";
import { RealtimeClock } from "../src/index";

describe("RealtimeClock in a real browser", () => {
  it("ticks on requestAnimationFrame", async () => {
    expect(navigator.userAgent).toMatch(/Chrom/);
    const clock = new RealtimeClock();
    const ticks = await new Promise<number>((resolve) => {
      let n = 0;
      clock.onTick(() => {
        if (++n === 3) resolve(n);
      });
      clock.start();
    });
    clock.stop();
    expect(ticks).toBe(3);
    expect(clock.now()).toBeGreaterThan(0);
  });
});
