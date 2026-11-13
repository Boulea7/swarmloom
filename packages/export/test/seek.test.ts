import { describe, expect, it } from "vitest";
import { AnimationSeeker, type SeekableAnimation, type SeekableSvg } from "../src/render/seek";

/** A Web Animation stand-in: playing ones move with "wall time" until paused. */
function fakeAnimation(currentTime: CSSNumberish | null, playbackRate = 1, playState: AnimationPlayState = "running") {
  const anim = {
    playState,
    playbackRate,
    currentTime,
    pauses: 0,
    pause() {
      anim.pauses++;
      anim.playState = "paused";
    },
  };
  return anim satisfies SeekableAnimation;
}

describe("AnimationSeeker", () => {
  it("pauses animations and sets their time from transport time, anchored at their pose when first seen", () => {
    const seeker = new AnimationSeeker();
    const loop = fakeAnimation(700);
    const fast = fakeAnimation(100, 2);
    expect(seeker.seekAnimations([loop, fast], 9000)).toBe(2);
    expect([loop.playState, loop.currentTime, fast.currentTime]).toEqual(["paused", 700, 100]);

    // Wall time moving the animation between frames changes nothing: only transport time counts.
    loop.currentTime = 12_345;
    seeker.seekAnimations([loop, fast], 9500);
    expect([loop.currentTime, fast.currentTime, loop.pauses]).toEqual([1200, 1100, 1]);

    // A late animation (a transition a seek started) is anchored at its start when it shows up,
    // whatever wall time it ran meanwhile, or at its end when it plays backwards. Seeking back is as
    // exact as seeking forward.
    const late = fakeAnimation(340);
    const back = Object.assign(fakeAnimation(90, -1), { effect: { getComputedTiming: () => ({ endTime: 500 }) } });
    seeker.seekAnimations([loop, late, back], 10_000);
    expect([late.currentTime, back.currentTime]).toEqual([0, 500]);
    seeker.seekAnimations([loop, late, back], 9000);
    expect([loop.currentTime, late.currentTime, back.currentTime]).toEqual([700, -1000, 1500]);
  });

  it("seeks only the animations no seek saw yet with seekNew, from their start", () => {
    const seeker = new AnimationSeeker();
    const loop = fakeAnimation(700);
    seeker.seekAnimations([loop], 1000);
    loop.currentTime = 12_345; // seekNew leaves it alone
    const started = fakeAnimation(80);
    expect(seeker.seekNew([loop, started], 1000)).toBe(1);
    expect([loop.currentTime, started.currentTime, started.playState]).toEqual([12_345, 0, "paused"]);
  });

  it("leaves idle and scroll-driven animations alone", () => {
    const seeker = new AnimationSeeker();
    const idle = fakeAnimation(null, 1, "idle");
    const scroll = fakeAnimation({ value: 50, unit: "percent" } as unknown as CSSNumberish);
    expect(seeker.seekAnimations([idle, scroll], 500)).toBe(0);
    expect([idle.pauses, scroll.pauses]).toEqual([0, 0]);
  });

  it("reads every animation before it writes any, so a seek flushes the page's style at most once", () => {
    // Chromium's CSS animation getters flush style; each pause() or currentTime write dirties it.
    let dirty = false;
    let flushes = 0;
    const read = () => {
      if (dirty) flushes++;
      dirty = false;
    };
    const cssAnimation = (): SeekableAnimation => {
      let time: CSSNumberish | null = 100;
      let state: AnimationPlayState = "running";
      return {
        get playState() {
          read();
          return state;
        },
        get playbackRate() {
          read();
          return 1;
        },
        get currentTime() {
          read();
          return time;
        },
        set currentTime(value) {
          dirty = true;
          time = value;
        },
        pause() {
          dirty = true;
          state = "paused";
        },
      };
    };
    const anims = Array.from({ length: 20 }, cssAnimation);
    expect(new AnimationSeeker().seekAnimations(anims, 1000)).toBe(20);
    expect(flushes).toBe(0);
    expect(anims.map((a) => [a.playState, a.currentTime])).toEqual(anims.map(() => ["paused", 100]));
  });

  it("starts SVG documents at 0 s when first seen and follows transport time in seconds", () => {
    const seeker = new AnimationSeeker();
    const calls: string[] = [];
    const svg: SeekableSvg = {
      pauseAnimations: () => calls.push("pause"),
      setCurrentTime: (s) => calls.push(`t=${s}`),
    };
    seeker.seekSvgs([svg], 4000);
    seeker.seekSvgs([svg], 5500);
    expect(calls).toEqual(["pause", "t=0", "pause", "t=1.5"]);
  });
});
