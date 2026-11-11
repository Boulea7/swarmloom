import { describe, expect, it } from "vitest";
import type { FollowMode } from "../../src/engine/options";
import { blueprintOf, box, type Harness, harness, samplePage } from "./fakes";

interface Result {
  median: number;
  p95: number;
  agents: number;
  built: number;
}

/** Times `frames` 60 Hz frames; `before` runs ahead of each one, outside the timing. */
function time(h: Harness, frames: number, before?: (f: number) => void): Result {
  const samples: number[] = [];
  const built = h.engine.progress.built;
  for (let f = 0; f < frames; f++) {
    before?.(f);
    const t0 = performance.now();
    h.clock.advance(1000 / 60);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[samples.length >> 1] as number,
    p95: samples[Math.floor(samples.length * 0.95)] as number,
    agents: h.stage.lastDrawn,
    built: h.engine.progress.built - built,
  };
}

function report(name: string, r: Result): void {
  console.info(
    `[bench] ${name} agents=${r.agents} built=${r.built} median=${r.median.toFixed(3)}ms p95=${r.p95.toFixed(3)}ms`,
  );
}

/**
 * Micro-benchmark: whole engine frames (scheduling, choreography stepping, motion, physics and
 * the AgentView list) with the fake stage's own bookkeeping switched off. The bound is loose on
 * purpose because shared machines are noisy; the logged median is the number to watch
 * (target < 2 ms).
 */
describe("engine frame cost", () => {
  it("builds a 4000-layer page with 48 agents well under 2 ms per frame", () => {
    const layers = Array.from({ length: 4000 }, (_, i) => box(`n${i}`, (i % 20) * 48, Math.floor(i / 20) * 40, 40, 30));
    for (const follow of ["none", "scroll"] as FollowMode[]) {
      const h = harness(blueprintOf(layers, { w: 960, h: 8000 }), { agents: 48, intro: false, follow });
      h.stage.record = false;
      void h.engine.play();
      h.run(240); // let the whole crew walk in
      const r = time(h, 600, (f) => {
        if (follow === "scroll" && f % 2 === 0) h.stage.userScroll(400 + f * 6);
      });
      report(`build follow=${follow} layers=4000`, r);
      expect(r.agents).toBe(48);
      expect(r.built).toBeGreaterThan(100);
      expect(r.median).toBeLessThan(8);
      h.engine.destroy();
    }
  });

  it("flocks the finale crew with the spatial hash", () => {
    const h = harness(samplePage(), { agents: 64, intro: false });
    h.stage.record = false;
    void h.engine.play();
    h.until(() => h.engine.state === "finale");
    h.stage.pointerAt = { x: 400, y: 300 };
    const r = time(h, 300);
    report("finale flock", r);
    expect(r.agents).toBeGreaterThan(40);
    expect(r.median).toBeLessThan(8);
  });
});
