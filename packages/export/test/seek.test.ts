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

    // A late animation is anchored when it shows up; seeking back is as exact as seeking forward.
    const late = fakeAnimation(0);
    seeker.seekAnimations([loop, late], 10_000);
    seeker.seekAnimations([loop, late], 9000);
    expect([loop.currentTime, late.currentTime]).toEqual([700, -1000]);
  });

  it("leaves idle and scroll-driven animations alone", () => {
    const seeker = new AnimationSeeker();
    const idle = fakeAnimation(null, 1, "idle");
    const scroll = fakeAnimation({ value: 50, unit: "percent" } as unknown as CSSNumberish);
    expect(seeker.seekAnimations([idle, scroll], 500)).toBe(0);
    expect([idle.pauses, scroll.pauses]).toEqual([0, 0]);
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
