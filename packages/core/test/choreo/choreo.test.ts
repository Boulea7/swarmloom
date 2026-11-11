import { describe, expect, it } from "vitest";
import { builtinPlugin, choreoHelpers } from "../../src/choreo/index";
import { placementPitch } from "../../src/choreo/notes";
import { parsePathAnchors } from "../../src/choreo/path-data";
import { headingSteps } from "../../src/choreo/tasks/heading";
import { splitGraphemes, typingUnits } from "../../src/choreo/text-units";
import {
  IMAGE_WAIT_FRAMES,
  MAX_ESTIMATE_MS,
  MAX_STROKES,
  MIN_ESTIMATE_MS,
  MIN_KEY_GAP_MS,
  TYPE_MAX_MS,
} from "../../src/choreo/timing";
import { planTyping, typingBudget } from "../../src/choreo/typing";
import { createRng } from "../../src/rng";
import type { Layer, TaskFn, TextLayer } from "../../src/types";
import { FRAME_MS, fakeAgent, fakeStage, run, startTask, Timeline } from "./fakes";

const tasks = builtinPlugin.tasks as Record<string, TaskFn<Layer>>;

/** How the engine picks a task (src/internal.ts "choreo"). */
function taskFor(layer: Layer): TaskFn<Layer> {
  const key = layer.master !== undefined ? "duplicate" : layer.kind === "custom" ? "fade" : layer.kind;
  const task = tasks[key];
  if (!task) throw new Error(`no task ${key}`);
  return task;
}

const text = (id: string, value: string, extra: Partial<TextLayer> = {}): TextLayer => ({
  id,
  kind: "text",
  box: { x: 100, y: 320, w: 520, h: 24 },
  text: value,
  html: value,
  style: { "font-size": "16px", "line-height": "24px" },
  ...extra,
});

const guide: Layer = { id: "g1", kind: "guide", box: { x: 100, y: 0, w: 0, h: 800 }, axis: "x", pos: 100 };
const masterTitle = text("title-a", "Routing", { box: { x: 100, y: 520, w: 200, h: 24 } });
const masterCard: Layer = {
  id: "card-a",
  kind: "box",
  box: { x: 90, y: 500, w: 220, h: 120 },
  style: { "background-color": "#f4f4f8", "border-radius": "12px" },
};
const masterLogo: Layer = { id: "logo-a", kind: "image", box: { x: 100, y: 660, w: 96, h: 40 }, src: "data:a" };
const LONG = "Swarm cursors weave the page back together, one stroke at a time. ".repeat(30);

const cases: Array<[string, Layer]> = [
  [
    "box with radius and shadow",
    { ...masterCard, id: "box", style: { ...masterCard.style, "box-shadow": "0 2px 8px #0003" } } as Layer,
  ],
  ["box larger than the viewport", { id: "hero", kind: "box", box: { x: 0, y: 500, w: 1280, h: 1400 }, style: {} }],
  ["short label", text("label", "Pricing", { box: { x: 100, y: 300, w: 60, h: 20 } })],
  ["heading", text("h1", "Weave it live", { fontSize: 48, box: { x: 100, y: 60, w: 620, h: 58 }, style: {} })],
  ["long paragraph", text("para", LONG, { box: { x: 100, y: 200, w: 640, h: 720 } })],
  ["text snapping to a guide", text("snapped", "Aligned copy", { snaps: ["g1"] })],
  ["text fade", text("faded", "Quiet", { reveal: "fade" })],
  ["guide", guide],
  [
    "path with pen",
    {
      id: "tri",
      kind: "path",
      box: { x: 10, y: 10, w: 100, h: 100 },
      d: "M10 10 L110 10 L110 110 Z",
      stroke: "#111",
      strokeWidth: 2,
      fill: "#f43",
    },
  ],
  [
    "complex path traced",
    {
      id: "wave",
      kind: "path",
      box: { x: 0, y: 0, w: 400, h: 40 },
      d: `M0 20 ${Array.from({ length: 40 }, (_, i) => `L${i * 10} ${i % 2 ? 0 : 40}`).join(" ")}`,
      stroke: "#111",
    },
  ],
  ["image sweep", { id: "img", kind: "image", box: { x: 500, y: 100, w: 300, h: 200 }, src: "data:x" }],
  [
    "image paint",
    { id: "paint", kind: "image", box: { x: 500, y: 100, w: 300, h: 200 }, src: "data:x", reveal: "paint" },
  ],
  ["image type", { id: "scan", kind: "image", box: { x: 100, y: 100, w: 400, h: 120 }, src: "data:x", reveal: "type" }],
  ["media", { id: "vid", kind: "media", box: { x: 100, y: 100, w: 640, h: 360 }, label: "Video  example.com" }],
  ["duplicate text", text("title-b", "Memory", { master: "title-a", box: { x: 340, y: 520, w: 200, h: 24 } })],
  [
    "duplicate box",
    { ...masterCard, id: "card-b", master: "card-a", box: { x: 330, y: 500, w: 220, h: 120 } } as Layer,
  ],
  [
    "duplicate image",
    { ...masterLogo, id: "logo-b", master: "logo-a", src: "data:b", box: { x: 340, y: 660, w: 96, h: 40 } } as Layer,
  ],
  ["duplicate without master", text("orphan", "Lost", { master: "missing" })],
  ["custom layer fallback", { id: "patch", kind: "custom", box: { x: 10, y: 10, w: 50, h: 50 }, task: "three:patch" }],
  ["zero-size layer", { id: "empty", kind: "box", box: { x: 10, y: 10, w: 0, h: 0 }, style: {} }],
];

const support: Layer[] = [guide, masterTitle, masterCard, masterLogo];

function play(layer: Layer, opts: { seed?: number; clock?: boolean } = {}) {
  const timeline = new Timeline();
  const agent = fakeAgent(timeline, opts);
  const stage = fakeStage(timeline, [...support, layer]);
  const ms = run(taskFor(layer), agent, layer, stage, timeline);
  return { timeline, agent, stage, ms };
}

describe("builtin choreographies", () => {
  it.each(cases.flatMap(([name, layer]) => [true, false].map((clock) => [name, clock, layer] as const)))(
    "%s (clock %s) finishes once and leaves nothing behind",
    (_name, clock, layer) => {
      const { timeline, agent, stage, ms } = play(layer, { clock });
      expect(stage.finished).toEqual([layer.id]);
      expect(stage.live.size).toBe(0);
      expect(agent.pressed).toBe(false);
      expect(agent.shape).toBe("arrow");
      expect(timeline.of("say").at(-1)?.text ?? "").toBe("");
      expect(timeline.of("press").length).toBe(timeline.of("release").length);
      // Transient styles end cleared: finish (which clears them) comes after the last setStyle.
      const lastStyle = timeline.lastIndex((e) => e.type === "style");
      const finishAt = timeline.log.findIndex((e) => e.type === "finish");
      expect(lastStyle < finishAt || timeline.of("style").at(-1)?.css === null).toBe(true);
      // Zero-size layers have nothing to draw and are revealed at once.
      if (layer.box.w > 0) expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(8000);
    },
  );

  it("types with key sounds proportional to length, capped, within the text time budget", () => {
    const counts = [5, 20, 60, 240, 3000].map((n) => {
      const { timeline, ms } = play(
        text(`t${n}`, "ab cd".repeat(n).slice(0, n), { box: { x: 100, y: 300, w: 640, h: 600 } }),
      );
      return { keys: timeline.sounds("key", "space").length, ms };
    });
    expect(counts.slice(0, 3).map((c) => c.keys)).toEqual([5, 20, 60]);
    for (let i = 1; i < counts.length; i++) expect(counts[i]?.keys).toBeGreaterThanOrEqual(counts[i - 1]?.keys ?? 0);
    expect(counts.at(-1)?.keys).toBeLessThanOrEqual(MAX_STROKES);
    // Opening the box, typing and the pauses around it: no text runs past ~6 s at 1x.
    expect(Math.max(...counts.map((c) => c.ms))).toBeLessThan(6000);
  });

  it("types a heading at a draft size, then drags it up in steps with rising ticks", () => {
    const layer = cases.find(([name]) => name === "heading")?.[1] as TextLayer;
    const { timeline } = play(layer);
    const ticks = timeline.sounds("tick");
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.map((t) => t.pitch)).toEqual(ticks.map((_, i) => i));
    const sizes = timeline
      .of("style")
      .map((e) => e.css?.["font-size"])
      .filter((v, i, all): v is string => v !== undefined && v !== all[i - 1])
      .map((v) => Number.parseFloat(v));
    // Draft at 50-60% of the final 48 px, then strictly rising to 48.
    expect(sizes[0]).toBeGreaterThanOrEqual(24);
    expect(sizes[0]).toBeLessThanOrEqual(29);
    expect(sizes.at(-1)).toBe(48);
    expect(sizes.every((v, i) => i === 0 || v > (sizes[i - 1] ?? 0))).toBe(true);
    // Typing happens at the draft size; growing is a resize drag.
    const lastKey = timeline.lastIndex((e) => e.type === "sound" && e.name === "key");
    const resize = timeline.log.findIndex((e) => e.type === "cursor" && e.shape === "resize");
    expect(lastKey).toBeLessThan(resize);
    expect(resize).toBeLessThan(timeline.log.findIndex((e) => e.type === "sound" && e.name === "tick"));

    // The document's own type scale wins over a geometric ladder; small body text never grows.
    expect(headingSteps(24, 48, { body: 16, sizes: [16, 30, 36, 40, 48] })).toEqual([30, 36, 40, 48]);
    expect(headingSteps(24, 48, { body: 16, sizes: [16, 48] })).toEqual([28.5, 34, 40.5, 48]);
    expect(headingSteps(26, 32, { body: 16, sizes: [16, 32] })).toHaveLength(2);
    expect(play(text("body", "Plain body copy")).timeline.sounds("tick")).toHaveLength(0);
  });

  it("snaps text onto its guide with a snap sound and ends at the final position", () => {
    const layer = cases.find(([name]) => name === "text snapping to a guide")?.[1] as TextLayer;
    const { timeline } = play(layer);
    expect(timeline.sounds("snap")).toHaveLength(1);
    const translates = timeline
      .of("style")
      .map((e) => e.css?.translate)
      .filter(Boolean);
    expect(translates[0]).not.toBe("0px 0px");
    expect(translates.at(-1)).toBe("0px 0px");
    // The guide is lit (active) when the snap sounds, and the text is let go only afterwards.
    const snapAt = timeline.log.findIndex((e) => e.type === "sound" && e.name === "snap");
    const lit = timeline.log.findIndex((e) => e.type === "overlay" && e.kind === "guide" && e.props?.active === true);
    expect(Math.abs(lit - snapAt)).toBeLessThanOrEqual(1);
    expect(timeline.lastIndex((e) => e.type === "release")).toBeGreaterThan(snapAt);
    // A guide that does not exist is never snapped to.
    expect(play(text("lost", "Lost", { snaps: ["nope"] })).timeline.sounds("snap")).toHaveLength(0);
  });

  it("types snapping text beside its guide without covering neighbouring content", () => {
    // A feature card: icon on top, then a heading on a shared baseline guide, then a paragraph.
    const card: Layer = { id: "card", kind: "box", box: { x: 940, y: 640, w: 290, h: 215 }, style: {} };
    const icon: Layer = { id: "icon", kind: "box", box: { x: 960, y: 660, w: 40, h: 40 }, style: {}, parent: "card" };
    const baseline: Layer = { id: "base", kind: "guide", box: { x: 320, y: 729, w: 880, h: 1 }, axis: "y", pos: 729 };
    const heading = text("share", "Share a draft", {
      parent: "card",
      snaps: ["base"],
      box: { x: 960, y: 713, w: 255, h: 22 },
      style: { "font-size": "16px", "line-height": "21.6px", "font-weight": "700" },
    });
    const body = text("body", "Send a read-only link.", { parent: "card", box: { x: 960, y: 750, w: 255, h: 48 } });
    for (let seed = 1; seed <= 12; seed++) {
      const timeline = new Timeline();
      const stage = fakeStage(timeline, [card, icon, baseline, heading, body]);
      run(taskFor(heading), fakeAgent(timeline, { seed }), heading, stage, timeline);
      const typedAt = timeline.of("style").find((e) => e.css?.translate)?.css?.translate ?? "";
      const dy = Number.parseFloat(typedAt.split(" ")[1] ?? "");
      // Off the baseline (still a visible snap), but clear of the icon above and the paragraph below.
      expect(Math.abs(dy), `seed ${seed}`).toBeGreaterThan(8);
      expect(713 + dy, `seed ${seed}`).toBeGreaterThanOrEqual(700);
      expect(713 + 22 + dy, `seed ${seed}`).toBeLessThanOrEqual(750);
    }
  });

  it("duplicates: selects the master before the drop, then retypes differing text", () => {
    const layer = cases.find(([name]) => name === "duplicate text")?.[1] as TextLayer;
    const { timeline } = play(layer);
    const log = timeline.log;
    const selectMaster = log.findIndex(
      (e) => e.type === "overlay" && e.op === "add" && e.kind === "selection" && e.props?.x === masterTitle.box.x,
    );
    const copyCursor = log.findIndex((e) => e.type === "cursor" && e.shape === "copy");
    const drop = log.findIndex((e, i) => i > copyCursor && e.type === "release");
    const measure = log.findIndex((e) => e.type === "overlay" && e.kind === "measure");
    expect(selectMaster).toBeGreaterThanOrEqual(0);
    expect(selectMaster).toBeLessThan(copyCursor);
    expect(measure).toBeGreaterThan(copyCursor);
    expect(drop).toBeGreaterThan(measure);
    const notes = log.findIndex((e, i) => i > drop && e.type === "sound" && e.name === "note");
    expect(notes).toBeGreaterThan(drop);
    // The copy shows the master's text until it is cleared (reveal 0) and retyped key by key.
    const cleared = log.findIndex((e, i) => i > drop && e.type === "reveal" && e.id === layer.id && e.p === 0);
    expect(cleared).toBeGreaterThan(drop);
    const keys = timeline.sounds("key", "space").filter((e) => e.t >= (log[cleared]?.t ?? 0));
    expect(keys.length).toBe("Memory".length + 1);

    const same = play(text("title-c", "Routing", { master: "title-a", box: { x: 580, y: 520, w: 200, h: 24 } }));
    expect(same.timeline.sounds("key", "space")).toHaveLength(0);
  });

  it("emits placement notes with pitch = 1 - normalized area", () => {
    const view = { x: 0, y: 0, w: 1280, h: 800 };
    const small = placementPitch({ x: 0, y: 0, w: 24, h: 24 }, view);
    const large = placementPitch({ x: 0, y: 0, w: 1200, h: 700 }, view);
    expect(small).toBeGreaterThan(large);
    expect(small).toBeLessThanOrEqual(1);
    expect(large).toBeGreaterThanOrEqual(0);
    const { timeline } = play(cases[0]?.[1] as Layer);
    const note = timeline.sounds("note")[0];
    expect(note?.pitch).toBeCloseTo(placementPitch(masterCard.box, view), 6);
  });

  it("reduced motion cross-fades without moving the cursor or drawing overlays", () => {
    const layer = cases[0]?.[1] as Layer;
    const timeline = new Timeline();
    const agent = fakeAgent(timeline);
    const stage = fakeStage(timeline, [layer]);
    const reduced = tasks.reduced as TaskFn<Layer>;
    const ms = run(reduced, agent, layer, stage, timeline);
    expect(stage.finished).toEqual([layer.id]);
    expect(timeline.of("overlay")).toHaveLength(0);
    expect({ x: agent.x, y: agent.y }).toEqual({ x: 40, y: 40 });
    expect(ms).toBeLessThanOrEqual(260);
  });

  it("waits a bounded number of frames for a pending image, never for a loaded one", () => {
    const layer = cases.find(([name]) => name === "image sweep")?.[1] as Layer;
    const timed = (complete: boolean): number => {
      const timeline = new Timeline();
      const stage = fakeStage(timeline, [layer]);
      const img = document.createElement("img");
      Object.defineProperty(img, "complete", { value: complete });
      stage.el = () => img;
      const ms = run(taskFor(layer), fakeAgent(timeline, { seed: 4 }), layer, stage, timeline);
      expect(stage.finished).toEqual([layer.id]);
      return ms;
    };
    // A broken or slow image costs exactly the bounded wait, then the reveal goes on.
    expect(timed(false) - timed(true)).toBe(IMAGE_WAIT_FRAMES * FRAME_MS);
  });

  it("is deterministic per seed", () => {
    const layer = cases.find(([name]) => name === "short label")?.[1] as Layer;
    expect(play(layer, { seed: 9 }).timeline.log).toEqual(play(layer, { seed: 9 }).timeline.log);
    expect(play(layer, { seed: 9 }).timeline.log).not.toEqual(play(layer, { seed: 10 }).timeline.log);
  });

  it("cleans up without finishing when aborted, and finishes before rethrowing on errors", () => {
    const layer = cases.find(([name]) => name === "long paragraph")?.[1] as Layer;
    const timeline = new Timeline();
    const agent = fakeAgent(timeline);
    const stage = fakeStage(timeline, [layer]);
    const gen = startTask(taskFor(layer), agent, layer, stage, timeline, 60);
    expect(stage.live.size).toBeGreaterThan(0);
    gen.return(undefined);
    expect(stage.live.size).toBe(0);
    expect(stage.finished).toEqual([]);
    expect(agent.pressed).toBe(false);

    const failing = fakeStage(timeline, [layer]);
    failing.failCaret = true;
    expect(() => run(taskFor(layer), fakeAgent(timeline), layer, failing, timeline)).toThrow("caretAt failed");
    expect(failing.finished).toEqual([layer.id]);
    expect(failing.live.size).toBe(0);
  });
});

describe("choreoHelpers.estimate", () => {
  it("is positive, bounded and close to the real duration", () => {
    for (const [name, layer] of cases) {
      const est = choreoHelpers.estimate(layer);
      expect(est, name).toBeGreaterThanOrEqual(MIN_ESTIMATE_MS);
      expect(est, name).toBeLessThanOrEqual(MAX_ESTIMATE_MS);
      if (name.startsWith("zero") || name.includes("without")) continue;
      const { ms } = play(layer);
      expect(est / ms, name).toBeGreaterThan(0.4);
      expect(est / ms, name).toBeLessThan(2.5);
    }
    const short = choreoHelpers.estimate(text("s", "Hi"));
    const long = choreoHelpers.estimate(text("l", LONG, { box: { x: 0, y: 0, w: 640, h: 720 } }));
    expect(long).toBeGreaterThan(short);
    const broken = { id: "x", kind: "box", box: { x: Number.NaN, y: 0, w: 10, h: 10 }, style: {} } as Layer;
    expect(choreoHelpers.estimate(broken)).toBe(MIN_ESTIMATE_MS);
  });
});

describe("choreo internals", () => {
  it("plans typing within a saturating budget and covers every grapheme", () => {
    expect(splitGraphemes("👩‍👩‍👧é")).toHaveLength(2);
    // Same unit model as the stage: one unit per run of HTML whitespace, no-break spaces kept apart.
    expect(typingUnits("a \r\n\t b\u00a0c")).toEqual(["a", " \r\n\t ", "b", "\u00a0", "c"]);
    let previous = 0;
    for (const n of [1, 10, 100, 1000, 10000]) {
      const budget = typingBudget(n);
      expect(budget).toBeGreaterThan(previous);
      expect(budget).toBeLessThanOrEqual(TYPE_MAX_MS);
      previous = budget;
    }
    const units = splitGraphemes(LONG);
    const strokes = planTyping(units, createRng(3));
    expect(strokes.at(-1)?.end).toBe(units.length);
    expect(strokes.every((s, i) => s.end > (strokes[i - 1]?.end ?? 0) && s.delay >= MIN_KEY_GAP_MS)).toBe(true);
    expect(planTyping([], createRng(3))).toEqual([]);
  });

  it("reads path anchors, including relative commands and compact arc flags, and stops on bad data", () => {
    const path = parsePathAnchors("M10 10 h20 v20 l-20 0 z m50 50 a5 5 0 1010 0");
    expect(path.subpaths).toEqual([
      [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
        { x: 10, y: 30 },
        { x: 10, y: 10 },
      ],
      [
        { x: 60, y: 60 },
        { x: 70, y: 60 },
      ],
    ]);
    expect(path.length).toBeCloseTo(90, 6);
    expect(path.truncated).toBe(false);
    expect(parsePathAnchors("M0 0 L10")).toMatchObject({ count: 1, truncated: true });
    expect(parsePathAnchors("nonsense")).toMatchObject({ count: 0, truncated: true });
  });
});
