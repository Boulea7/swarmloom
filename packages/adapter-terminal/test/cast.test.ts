import { describe, expect, it } from "vitest";
import {
  buildTerminalBlueprint,
  buildTimeline,
  CastError,
  type CastRecording,
  createTerminalAdapter,
  looksLikeCast,
  type PlayEvent,
  parseCast,
  readScreenData,
  SCREEN_TASK,
  STEP_TASK,
  splitSteps,
  type TerminalScreenData,
  terminalAdapter,
} from "../src/index";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const ctx = { document, width: 900, theme: "light" as const };

const V2 = [
  '{"version": 2, "width": 40, "height": 6, "title": "demo", "idle_time_limit": 1, "env": {"SHELL": "/bin/bash"}}',
  '[0.1, "o", "$ "]',
  '[0.5, "i", "l"]',
  '[0.505, "o", "l"]',
  '[0.6, "i", "s"]',
  '[0.605, "o", "s"]',
  '[0.8, "i", "\\r"]',
  '[0.805, "o", "\\r\\n"]',
  '[5.0, "o", "a.txt  b.txt\\r\\n$ "]',
  '[5.2, "r", "50x8"]',
  '[5.3, "m", "chapter"]',
].join("\n");

const V3 = [
  '{"version": 3, "term": {"cols": 30, "rows": 5, "theme": {"fg": "#eeeeee", "bg": "#111111", "palette": "#000000:#aa0000:#00aa00:#aaaa00:#0000aa:#aa00aa:#00aaaa:#aaaaaa"}}, "command": "htop"}',
  "# a comment line",
  '[0.2, "o", "hi"]',
  '[0.3, "o", " there"]',
  '[1.0, "x", "0"]',
].join("\n");

const V1 = JSON.stringify(
  { version: 1, width: 20, height: 3, duration: 1, command: "/bin/sh", stdout: [[0.1, "a"], [0.2, "b"], "bad"] },
  null,
  2,
);

describe("parseCast", () => {
  it("reads v2 headers and events with absolute times", () => {
    const rec = parseCast(V2);
    expect(rec).toMatchObject({
      version: 2,
      cols: 40,
      rows: 6,
      title: "demo",
      shell: "/bin/bash",
      idleTimeLimit: 1000,
    });
    expect(rec.events.map((e) => e.code)).toEqual(["o", "i", "o", "i", "o", "i", "o", "o", "r", "m"]);
    expect(rec.events[1]?.t).toBe(500);
    expect(rec.skipped).toBe(0);
  });

  it("sums v3 intervals, reads term.theme and skips comments", () => {
    const rec = parseCast(V3);
    expect(rec).toMatchObject({ version: 3, cols: 30, rows: 5, command: "htop" });
    expect(rec.events.map((e) => Math.round(e.t))).toEqual([200, 500, 1500]);
    expect(rec.theme?.bg).toBe("#111111");
    expect(rec.theme?.palette[1]).toBe("#aa0000");
  });

  it("reads pretty-printed v1 documents", () => {
    const rec = parseCast(V1);
    expect(rec.version).toBe(1);
    expect(rec.events.map((e) => [Math.round(e.t), e.data])).toEqual([
      [100, "a"],
      [300, "b"],
    ]);
    expect(rec.skipped).toBe(1);
  });

  it("clamps out-of-order v2 times and strips the BOM", () => {
    const rec = parseCast(`﻿{"version":2,"width":5,"height":2}\n[1,"o","a"]\n[0.5,"o","b"]\n`);
    expect(rec.events.map((e) => e.t)).toEqual([1000, 1000]);
  });

  const rejects: [string, string, RegExp][] = [
    ["empty file", "\n\n", /empty/],
    ["not JSON", "hello world", /not a JSON header/],
    ["unsupported version", '{"version": 4, "width": 2, "height": 2}', /unsupported version 4/],
    ["header is an array", "[1, 2]", /not a JSON object/],
    ["missing width", '{"version": 2, "height": 2}', /invalid terminal width/],
    ["zero rows", '{"version": 3, "term": {"cols": 2, "rows": 0}}', /invalid terminal rows/],
    ["oversized terminal", '{"version": 2, "width": 5000, "height": 2}', /exceeds the limit/],
    [
      "mostly malformed",
      '{"version": 2, "width": 2, "height": 2}\nnope\n[1, "z", "a"]\n[1, "o", "a"]',
      /2 of 3 event lines/,
    ],
    ["v1 without frames", '{"version": 1, "width": 2, "height": 2}', /stdout/],
  ];
  it.each(rejects)("rejects: %s", (_name, source, message) => {
    expect(() => parseCast(source)).toThrow(CastError);
    expect(() => parseCast(source)).toThrow(message);
  });

  it("sniffs v2/v3 headers only", () => {
    expect(looksLikeCast(enc(V2))).toBe(true);
    expect(looksLikeCast(enc(V3))).toBe(true);
    expect(looksLikeCast(enc('{"version": 2, "name": "pkg"}'))).toBe(false);
    expect(looksLikeCast(enc("plain text"))).toBe(false);
    expect(looksLikeCast(enc('{"nbformat": 4, "cells": []}'))).toBe(false);
  });
});

describe("buildTimeline", () => {
  it("caps idle gaps with the header limit and marks keystrokes", () => {
    const tl = buildTimeline(parseCast(V2));
    expect(tl.recordedInput).toBe(true);
    // 0.805 s -> 5.0 s is capped to the header's 1 s idle limit.
    const out = tl.events.find((e) => e.data.startsWith("a.txt")) as PlayEvent;
    const enter = tl.events.find((e) => e.data === "\r\n") as PlayEvent;
    expect(out.t - enter.t).toBeCloseTo(1000, 5);
    expect(tl.events.filter((e) => e.typed).map((e) => e.data)).toEqual(["l", "l", "s", "s", "\r", "\r\n"]);
    expect(tl.events.some((e) => (e.kind as string) === "m")).toBe(false);
    expect(tl.steps.map((s) => s.input)).toEqual([false, true, false]);
    expect(tl.steps[1]?.t0).toBe(tl.steps[0]?.t1);
  });

  it("infers typing from short echoes without input events", () => {
    const rec: CastRecording = {
      version: 2,
      cols: 20,
      rows: 3,
      skipped: 0,
      events: [
        { t: 0, code: "o", data: "$ " },
        { t: 200, code: "o", data: "e" },
        { t: 320, code: "o", data: "c" },
        { t: 400, code: "o", data: "\r\n" },
        { t: 420, code: "o", data: "a long chunk of program output\r\n" },
      ],
    };
    const tl = buildTimeline(rec);
    expect(tl.recordedInput).toBe(false);
    expect(tl.events.map((e) => e.typed)).toEqual([false, true, true, true, false]);
  });

  it("counts only keystroke echo as typing, not output or a prompt right after the Enter", () => {
    const rec: CastRecording = {
      version: 2,
      cols: 20,
      rows: 4,
      skipped: 0,
      events: [
        { t: 0, code: "i", data: "q" },
        { t: 1, code: "o", data: "q" },
        { t: 100, code: "i", data: "\r" },
        { t: 101, code: "o", data: "\r\n\u001b[?2004l\r" },
        { t: 103, code: "o", data: "ok\r\n" },
        { t: 135, code: "o", data: "\u001b[?2004h\r\r\n$ " },
      ],
    };
    expect(buildTimeline(rec).events.map((e) => e.typed)).toEqual([true, true, true, true, false, false]);
  });

  it("fits long sessions into the budget and keeps steps short", () => {
    const events = Array.from({ length: 400 }, (_, i) => ({ t: i * 1000, code: "o" as const, data: `line ${i}\r\n` }));
    const tl = buildTimeline(
      { version: 2, cols: 20, rows: 5, skipped: 0, events },
      { idleLimit: 2000, maxDuration: 30_000 },
    );
    expect(tl.duration).toBeCloseTo(30_000, 0);
    expect(tl.scale).toBeLessThan(1);
    for (const s of tl.steps) expect(s.t1 - s.t0).toBeLessThanOrEqual(6000);
    expect(tl.steps.at(-1)?.to).toBe(400);
  });

  it("splits by event count", () => {
    const events: PlayEvent[] = Array.from({ length: 10 }, (_, i) => ({ t: i, kind: "o", data: "x", typed: false }));
    expect(splitSteps(events, 1e9, 4).map((s) => [s.from, s.to])).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
    ]);
  });
});

describe("buildTerminalBlueprint", () => {
  it("lays out a fitted window with chained steps", () => {
    const rec = parseCast(V2);
    const bp = buildTerminalBlueprint(rec, buildTimeline(rec), { document, width: 900, scheme: "light" });
    const screen = bp.layers.find((l) => l.id === "term-screen");
    expect(screen?.kind).toBe("custom");
    const data = readScreenData(screen?.kind === "custom" ? screen.data : null) as TerminalScreenData;
    expect(data).not.toBeNull();
    // The resize event keeps the full size (50x8) instead of fitting.
    expect([data.cols, data.rows]).toEqual([50, 8]);
    const steps = bp.layers.filter((l) => l.kind === "custom" && l.task === STEP_TASK);
    expect(steps).toHaveLength(data.steps.length);
    expect(steps[0]?.parent).toBe("term-screen");
    expect(steps[1]?.parent).toBe(steps[0]?.id);
    expect(bp.plugins).toEqual(["terminal"]);
    expect(bp.layers.find((l) => l.id === "term-title")).toMatchObject({ text: "demo" });
    expect(bp.layers.filter((l) => l.master === "term-dot-1")).toHaveLength(2);
    for (const l of bp.layers) {
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(bp.size.w);
      expect(l.box.y + l.box.h).toBeLessThanOrEqual(bp.size.h);
    }
  });

  it("shrinks to the used rows and columns and scales the font to the width", () => {
    const rec = parseCast('{"version":2,"width":200,"height":50}\n[0.1,"o","short\\r\\nlines"]');
    const bp = buildTerminalBlueprint(rec, buildTimeline(rec), { document, width: 500, scheme: "dark" });
    const screen = bp.layers.find((l) => l.id === "term-screen");
    const data = (screen?.kind === "custom" ? screen.data : null) as TerminalScreenData;
    expect(data.rows).toBe(4);
    expect(data.cols).toBe(40);
    expect(bp.background).toBe("#0B0B12");
    expect(bp.size.w).toBeLessThanOrEqual(500);
  });

  it("notes the alternate screen and validates screen data", () => {
    const rec = parseCast('{"version":2,"width":20,"height":4}\n[0.1,"o","\\u001b[?1049hvim\\u001b[?1049l"]');
    const bp = buildTerminalBlueprint(rec, buildTimeline(rec), { document, width: 600, scheme: "light" });
    const screen = bp.layers.find((l) => l.id === "term-screen");
    const notes = (screen?.meta?.notes ?? []) as string[];
    expect(String(notes[0])).toMatch(/alternate screen/);
    expect(readScreenData({ v: 1 })).toBeNull();
    const data = screen?.kind === "custom" ? (screen.data as TerminalScreenData) : null;
    expect(readScreenData({ ...data, font: "x;}</style>" })).toBeNull();
    expect(
      readScreenData({
        ...data,
        events: [
          [5, "o", "a", 0],
          [1, "o", "b", 0],
        ],
      }),
    ).toBeNull();
  });
});

describe("terminalAdapter", () => {
  it("declares its format", () => {
    expect(terminalAdapter).toMatchObject({ id: "terminal", extensions: ["cast"], mime: ["application/x-asciicast"] });
    expect(terminalAdapter.sniff?.(enc(V2))).toBe(true);
  });
  it("loads text and bytes, and rejects bad input", async () => {
    const a = await terminalAdapter.load({ text: V2, name: "rec/demo.cast" }, ctx);
    expect(a.blueprint.source).toMatchObject({ type: "terminal", name: "demo.cast" });
    expect(a.plugins?.[0]?.name).toBe("terminal");
    const b = await terminalAdapter.load({ bytes: enc(V3) }, ctx);
    expect(b.blueprint.layers.some((l) => l.kind === "custom" && l.task === SCREEN_TASK)).toBe(true);
    expect(b.plugins?.[0]).not.toBe(a.plugins?.[0]);
    await expect(terminalAdapter.load({}, ctx)).rejects.toThrow(/text, bytes or a URL/);
    await expect(terminalAdapter.load({ text: "nope" }, ctx)).rejects.toThrow(CastError);
    await expect(createTerminalAdapter({ maxBytes: 10 }).load({ text: V2 }, ctx)).rejects.toThrow(/too large/);
    await expect(terminalAdapter.load({ text: V2 }, { ...ctx, width: 0 })).rejects.toThrow(/width/);
  });
});
