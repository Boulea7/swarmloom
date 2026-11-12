import { expect, it } from "vitest";
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
