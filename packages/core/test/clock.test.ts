import { describe, expect, it } from "vitest";
import { RealtimeClock, VirtualClock } from "../src/index";

describe("VirtualClock", () => {
  it("ticks only on advance while running", () => {
    const clock = new VirtualClock();
    const ticks: [number, number][] = [];
    const off = clock.onTick((dt, now) => ticks.push([dt, now]));

    clock.advance(10); // stopped: no-op
    clock.start();
    clock.advance(16);
    clock.advance(0);
    clock.advance(17);
    off();
    clock.advance(5);

    expect(ticks).toEqual([
      [16, 16],
      [0, 16],
      [17, 33],
    ]);
    expect(clock.now()).toBe(38);
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
  });
});

describe("RealtimeClock", () => {
  it("accumulates clamped frame deltas and stops cleanly", () => {
    let time = 1000;
    let pending: (() => void) | null = null;
    const clock = new RealtimeClock({
      maxDeltaMs: 100,
      time: () => time,
      requestFrame: (cb) => {
        pending = cb;
        return 1;
      },
      cancelFrame: () => {
        pending = null;
      },
    });
    const frame = (advanceBy: number): void => {
      time += advanceBy;
      const cb = pending;
      pending = null;
      cb?.();
    };
    const dts: number[] = [];
    clock.onTick((dt) => dts.push(dt));

    clock.start();
    expect(clock.running).toBe(true);
    frame(16);
    frame(5000); // long gap is clamped
    clock.stop();
    frame(16); // nothing scheduled after stop

    expect(dts).toEqual([16, 100]);
    expect(clock.now()).toBe(116);
    expect(clock.running).toBe(false);
  });
});
