import { expect, it, vi } from "vitest";
import { RenderSession } from "../src/index";
import { ClockPlayer } from "./fake-player";

const blueprint = {
  version: 1 as const,
  source: { type: "fake" },
  size: { w: 10, h: 10 },
  background: "#fff",
  layers: [],
};

it("draws only the engine tick each step ends on: the frame is captured after it", async () => {
  const session = new RenderSession({
    player: { blueprint },
    tickRate: 120,
    createPlayer: (options) => new ClockPlayer(options),
  });
  const draws: boolean[] = [];
  session.clock.onTick((_dt, _now, draw) => draws.push(draw !== false));
  await session.start();
  // 15 fps: eight whole ticks. Then 20 ms: two whole ticks and a short one to 86.7 ms.
  await session.step(1000 / 15);
  await session.step(20);
  session.dispose();
  expect(draws).toEqual([false, false, false, false, false, false, false, true, false, false, true]);
});

it("applies a cue at a frame time between two ticks when that comes before the next tick", async () => {
  const player: { current?: ClockPlayer } = {};
  const session = new RenderSession({
    player: { blueprint },
    tickRate: 120,
    // 25 fps: the frame at 40 ms falls between the ticks at 33.3 and 41.7 ms.
    cues: [
      { at: 39, action: "speed", speed: 2 },
      { at: 41, action: "speed", speed: 3 },
    ],
    createPlayer: (options) => {
      player.current = new ClockPlayer(options);
      return player.current;
    },
  });
  await session.start();
  await session.step(40);
  await session.step(40);
  session.dispose();
  // Each shows from the first frame at or after it: 39 ms on the short tick to 40, 41 ms on the tick at 41.7.
  const speeds = player.current?.speeds ?? [];
  expect(speeds.map(([, speed]) => speed)).toEqual([2, 3]);
  expect(speeds[0]?.[0]).toBeCloseTo(40, 6);
  expect(speeds[1]?.[0]).toBeCloseTo(5000 / 120, 6);
});

it("runs past the tail until a later live cue goes live, instead of ending in the finale", async () => {
  const player: { current?: ClockPlayer } = {};
  // Built at 1000 ms, so the 200 ms tail alone would end the video at 1200 ms, before the cue.
  const session = new RenderSession({
    player: { blueprint },
    tailMs: 200,
    live: true,
    cues: [{ at: 2000, action: "live" }],
    tickRate: 120,
    createPlayer: (options) => {
      const fake = new ClockPlayer(options);
      fake.goLive = () => options.onLive?.();
      player.current = fake;
      return fake;
    },
  });
  const goLive = vi.spyOn(player.current as ClockPlayer, "goLive");
  let status = await session.start();
  while (!status.done && session.elapsed < 5000) status = await session.step(40);
  session.dispose();
  expect(goLive).toHaveBeenCalledOnce();
  expect(session.elapsed).toBeCloseTo(2000, 6);
});
