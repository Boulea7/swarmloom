import { describe, expect, it, vi } from "vitest";
import { createI18n } from "../../src/i18n/index";
import { createAutoHide } from "../../src/ui/autohide";
import { type ClientRect, placeDock } from "../../src/ui/placement";
import { buildView, DEFAULT_SETTINGS, translator, type ViewInput } from "../../src/ui/view-model";

describe("placeDock (viewport segments)", () => {
  const host: ClientRect = { left: 0, top: 0, width: 1600, height: 900 };
  const sideBySide: ClientRect[] = [
    { left: 0, top: 0, width: 780, height: 900 },
    { left: 820, top: 0, width: 780, height: 900 },
  ];
  const stacked: ClientRect[] = [
    { left: 0, top: 0, width: 1600, height: 430 },
    { left: 0, top: 470, width: 1600, height: 430 },
  ];

  it.each([
    ["no segments: default bottom-centre", null, null, null],
    ["side by side, no focus: right segment", sideBySide, null, { segment: 1, left: 820, width: 780, bottom: 0 }],
    [
      "side by side, focus right: left segment",
      sideBySide,
      { x: 1000, y: 300 },
      { segment: 0, left: 0, width: 780, bottom: 0 },
    ],
    [
      "stacked, focus top: bottom segment",
      stacked,
      { x: 800, y: 100 },
      { segment: 1, left: 0, width: 1600, bottom: 0 },
    ],
    [
      "stacked, focus bottom: above the hinge",
      stacked,
      { x: 800, y: 700 },
      { segment: 0, left: 0, width: 1600, bottom: 470 },
    ],
  ] as const)("%s", (_name, segments, focus, expected) => {
    expect(placeDock(host, segments, focus, null)).toEqual(expected);
  });

  it("keeps the current segment while the focus is elsewhere (no jumping)", () => {
    expect(placeDock(host, sideBySide, null, 0)?.segment).toBe(0);
    expect(placeDock(host, sideBySide, { x: 100, y: 100 }, 0)?.segment).toBe(1);
  });
});

describe("auto-hide", () => {
  it("hides after the quiet period, stays while pinned and toggles on tap", () => {
    vi.useFakeTimers();
    try {
      const shown: boolean[] = [];
      const hide = createAutoHide({
        delayMs: 2500,
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        apply: (v) => shown.push(v),
      });
      hide.activity();
      vi.advanceTimersByTime(2000);
      hide.activity(); // activity restarts the quiet period
      vi.advanceTimersByTime(2000);
      expect(hide.shown).toBe(true);
      vi.advanceTimersByTime(600);
      expect(hide.shown).toBe(false);

      hide.toggle();
      expect(hide.shown).toBe(true);
      hide.pin("phase", true);
      vi.advanceTimersByTime(10_000);
      hide.toggle();
      expect(hide.shown).toBe(true);
      hide.pin("phase", false);
      vi.advanceTimersByTime(2500);
      expect(shown).toEqual([false, true, false]);
      hide.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildView", () => {
  const t = translator(createI18n("en"));
  const base: ViewInput = {
    state: "building",
    built: 3,
    total: 12,
    etaMs: 42_000,
    settings: { ...DEFAULT_SETTINGS },
    soundLocked: false,
    compact: false,
    canRecord: false,
    canFinish: true,
    timeline: null,
  };

  it("shows build controls while running and go live as the primary action when done", () => {
    const running = buildView(base, t);
    expect(running.percent).toBe(25);
    expect(running.progressText).toBe("3 of 12 layers · About 40 seconds left");
    expect(running).toMatchObject({ play: { visible: true, icon: "pause" }, speed: { visible: true }, pinned: false });
    expect(running.goLive).toEqual({ visible: true, primary: false });
    // Narrow touch screens keep a tappable way past the build: finish now, else go live.
    const narrow = { ...base, compact: true };
    expect(buildView(narrow, t)).toMatchObject({ finish: true, replay: false, goLive: { visible: false } });
    expect(buildView({ ...narrow, canFinish: false }, t)).toMatchObject({ finish: false, goLive: { visible: true } });
    // Finish now only exists while building, and only when the player offers it.
    expect(running.finish).toBe(true);
    expect(buildView({ ...base, canFinish: false }, t).finish).toBe(false);

    const done = buildView({ ...base, state: "done", built: 12 }, t);
    expect(done).toMatchObject({ percent: 100, pinned: true, play: { visible: false }, speed: { visible: false } });
    expect(done.goLive).toEqual({ visible: true, primary: true });
    expect(done.finish).toBe(false);
    expect(done.progressText).toBe("12 layers built");
  });

  it("offers the seek bar only with a timeline, in 100 ms steps, full once done", () => {
    expect(buildView(base, t).seek.visible).toBe(false);
    const timeline = { elapsed: 12_340, duration: 31_000 };
    expect(buildView({ ...base, timeline }, t).seek).toEqual({
      visible: true,
      value: 123,
      max: 310,
      text: "0:12 of 0:31",
    });
    expect(buildView({ ...base, state: "done", timeline }, t).seek).toMatchObject({ value: 310, max: 310 });
    // Nothing to seek before play or without a known length.
    expect(buildView({ ...base, state: "idle", timeline }, t).seek.visible).toBe(false);
    expect(buildView({ ...base, timeline: { elapsed: 0, duration: Number.NaN } }, t).seek.visible).toBe(false);
  });

  it("never reports 100% before the build is done and clamps bad progress", () => {
    expect(buildView({ ...base, built: 999, total: 1000 }, t).percent).toBe(99);
    expect(buildView({ ...base, built: 50, total: 10 }, t).fraction).toBe(1);
    expect(buildView({ ...base, built: Number.NaN, total: -3 }, t).progressText).toBe("Getting ready…");
  });
});
