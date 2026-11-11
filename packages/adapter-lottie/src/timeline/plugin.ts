import type { AgentApi, CustomLayer, LayerRenderer, Plugin, StageApi, TaskFn, TaskGen } from "@swarmloom/core";
import { readTimeline, TIMELINE_PLUGIN, TIMELINE_TASK, type TimelineSpec } from "./data";
import { type AnimTarget, animTargetOf } from "./target";
import { barGeometry, type TimelineFrame, TimelineView } from "./view";

/* Choreography timing, engine ms at speed 1. */
const BAR_MS = { base: 420, perPx: 0.9, min: 500, max: 1400 };
const HOP_MS = { base: 90, perPx: 0.7, min: 110, max: 420 };
const CLICK_MS = 70;
const SETTLE_MS = 120;
const SCRUB_BACK_MS = { base: 260, perPx: 0.6, min: 260, max: 900 };
const SCRUB_MS = { share: 0.4, min: 900, max: 1800 };
/** The playhead handle is grabbed this far above the bar, px. */
const GRAB_DY = 14;
/** Space a diamond needs on the bar, px. */
const MARK_SPACING = 22;
/** Most diamonds dropped on one bar. */
const MAX_MARKS = 12;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function span(spec: { base: number; perPx: number; min: number; max: number }, px: number): number {
  return clamp(spec.base + spec.perPx * Math.abs(px), spec.min, spec.max);
}

/** Diamonds that fit a bar inside a box `w` px wide. */
export function marksFor(w: number): number {
  return clamp(Math.floor(barGeometry(w, 0).len / MARK_SPACING), 2, MAX_MARKS);
}

/**
 * Runs `inner` (a move or drag) and calls `onStep` after every step, once the agent moved for
 * that frame, so the bar and playhead follow the cursor exactly. Closing the outer generator
 * also closes `inner`.
 */
function* track(inner: TaskGen, onStep: () => void): TaskGen {
  let done = false;
  try {
    let input: unknown;
    for (;;) {
      const step = inner.next(input);
      onStep();
      if (step.done) {
        done = true;
        return;
      }
      input = yield step.value;
    }
  } finally {
    if (!done) inner.return(undefined);
  }
}

/** Build state of a timeline while its task runs (the stage only knows reveal and finish). */
interface TaskProgress {
  marks: number;
  head: number | null;
}

interface Mounted {
  view: TimelineView;
  spec: TimelineSpec;
  stage: StageApi;
  bar: number;
  done: boolean;
  /** Cached animation target (resolved lazily, stable for the life of this mount). */
  target: AnimTarget | undefined;
}

function resolveTarget(stage: StageApi, spec: TimelineSpec): AnimTarget | undefined {
  return spec.target ? animTargetOf(stage.el(spec.target)) : undefined;
}

/**
 * Creates the `anim:timeline` plugin: after the static weave, one agent drags out a mini timeline
 * bar under the animated element, drops keyframe diamonds, grabs the playhead where the woven
 * pose sits, scrubs back to the start and across the whole cycle (the target follows), and then
 * starts playback. When finished, the playhead keeps following the target's time.
 *
 * Without motion (reduced motion, finish-all) the task never runs: the bar appears complete and
 * the target keeps showing the static pose.
 *
 * One plugin instance serves one player at a time.
 */
export function createAnimTimelinePlugin(): Plugin {
  const mounted = new Map<CustomLayer, Mounted>();
  const progress = new WeakMap<CustomLayer, TaskProgress>();

  const targetOf = (m: Mounted): AnimTarget | undefined => {
    m.target ??= resolveTarget(m.stage, m.spec);
    return m.target;
  };

  const draw = (layer: CustomLayer): void => {
    const m = mounted.get(layer);
    if (!m) return;
    const frame: TimelineFrame = { bar: m.bar, marks: 0, head: null };
    if (m.done) {
      frame.marks = m.view.markCount;
      const t = targetOf(m)?.time() ?? null;
      frame.head = t === null ? m.spec.rest : clamp(t / m.spec.duration, 0, 1);
    } else {
      const p = progress.get(layer);
      frame.marks = p?.marks ?? 0;
      frame.head = p?.head ?? null;
    }
    m.view.render(frame);
  };

  const renderer: LayerRenderer<CustomLayer> = {
    mount(layer, container, stage) {
      const spec = readTimeline(layer, marksFor(layer.box.w));
      if (!spec) return;
      const view = new TimelineView(container.ownerDocument, spec, layer.box.w, layer.box.h);
      mounted.set(layer, { view, spec, stage, bar: 0, done: false, target: undefined });
      draw(layer);
      return view.root;
    },
    reveal(layer, p) {
      const m = mounted.get(layer);
      if (!m) return;
      m.bar = p;
      m.done = false;
      draw(layer);
    },
    finish(layer) {
      const m = mounted.get(layer);
      if (!m) return;
      m.bar = 1;
      m.done = true;
      draw(layer);
    },
    unmount(layer) {
      mounted.delete(layer);
    },
  };

  const task: TaskFn<CustomLayer> = function* (agent: AgentApi, layer: CustomLayer, stage: StageApi): TaskGen {
    const spec = readTimeline(layer, marksFor(layer.box.w));
    if (!spec) {
      stage.finish(layer.id);
      return;
    }
    const prog: TaskProgress = { marks: 0, head: null };
    progress.set(layer, prog);
    let target = resolveTarget(stage, spec);
    let playing = false;
    try {
      target?.reset();
      const geo = barGeometry(layer.box.w, layer.box.h);
      const x = (f: number): number => layer.box.x + geo.x0 + f * geo.len;
      const y = layer.box.y + geo.cy;
      const at = (): number => clamp((agent.x - layer.box.x - geo.x0) / geo.len, 0, 1);

      // 1. Drag the bar out from its left end.
      yield* agent.moveTo(x(0), y);
      agent.setCursor("crosshair");
      agent.press();
      agent.sound("press");
      yield* track(agent.dragTo(x(1), y, { dur: span(BAR_MS, geo.len), ease: "inOut" }), () => {
        stage.reveal(layer.id, at());
      });
      stage.reveal(layer.id, 1);
      agent.release();
      agent.sound("release");

      // 2. Drop one diamond per keyframe mark.
      agent.setCursor("pen");
      for (let i = 0; i < spec.marks.length; i++) {
        const mx = x(spec.marks[i] as number);
        yield* agent.moveTo(mx, y, { dur: span(HOP_MS, mx - agent.x), ease: "out" });
        agent.press();
        prog.marks = i + 1;
        draw(layer);
        agent.sound("pen");
        yield CLICK_MS;
        agent.release();
      }
      yield SETTLE_MS;

      // 3. Grab the playhead at the woven pose, scrub to the start, then across the cycle.
      target ??= resolveTarget(stage, spec);
      const ready = target?.ready?.();
      if (ready) yield ready;
      prog.head = spec.rest;
      draw(layer);
      const hy = y - GRAB_DY;
      agent.setCursor("hand");
      yield* agent.moveTo(x(spec.rest), hy, { dur: span(HOP_MS, x(spec.rest) - agent.x) });
      agent.setCursor("grab");
      agent.press();
      agent.sound("press");
      const scrub = (): void => {
        const f = at();
        prog.head = f;
        target?.seek(f * spec.duration);
        draw(layer);
      };
      scrub();
      yield* track(agent.dragTo(x(0), hy, { dur: span(SCRUB_BACK_MS, x(0) - agent.x), ease: "inOut" }), scrub);
      const forward = clamp(spec.duration * SCRUB_MS.share, SCRUB_MS.min, SCRUB_MS.max);
      yield* track(agent.dragTo(x(1), hy, { dur: forward, ease: "linear" }), scrub);
      agent.release();
      agent.sound("release");
      agent.setCursor("arrow");

      // 4. Play from the start, timed by the engine clock.
      target?.play(0);
      playing = true;
      stage.finish(layer.id);
    } finally {
      progress.delete(layer);
      // Aborted (replay, go live, finish now): leave the static pose, never a half-scrubbed frame.
      if (!playing) target?.reset();
    }
  };

  return {
    name: TIMELINE_PLUGIN,
    tasks: { [TIMELINE_TASK]: task },
    renderers: { [TIMELINE_TASK]: renderer },
    frame() {
      for (const [layer, m] of mounted) if (m.done) draw(layer);
    },
  };
}
