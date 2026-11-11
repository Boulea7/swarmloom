import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest, cueFrame, eventsDocument, type ManifestInput, sha256Hex } from "../src/pipeline/evidence";

const events = [
  { t: 333.3333333333333, name: "note", pan: 0.2, pitch: 3, vel: 0.8 },
  { t: 1000, name: "chord", pan: 0 },
];

const manifestInput: ManifestInput = {
  tool: { name: "swarmloom", version: "0.1.0" },
  argv: ["render", "a.svg", "--seed", "7"],
  manifestFile: path.resolve("/w/takes/m.json"),
  input: { arg: "a.svg", kind: "file", name: "a.svg", format: "svg", sha256: "ab", bytes: 2 },
  info: { estimatedMs: 900, layers: 3, blueprintSha256: "c".repeat(64) },
  video: { format: "mp4", width: 1080, height: 1080, scale: 2, fps: 30 },
  settings: { seed: 7, agents: 8, sound: true, bpm: 90 },
  fixedLength: true,
  maxDurationMs: 2000,
  cues: [{ spec: "1b:pause", at: 666.6666666666666, frame: 20, action: "pause" }],
  programs: {
    browser: { path: "/c", version: "150" },
    ffmpeg: null,
    playwrightCore: "1.65.0",
    node: "v24",
    platform: "linux",
    arch: "x64",
  },
  fonts: [{ family: "Noto Serif", postScriptName: "NotoSerif-Bold", custom: false, glyphs: 9 }],
  result: {
    frames: 2,
    durationMs: 66.7,
    builtAtMs: null,
    finished: false,
    imageType: "png",
    frameSha256: ["1", "2"],
  },
  events,
  outputs: {},
};

describe("capture evidence", () => {
  it("puts each cue on the first frame at or after its time", () => {
    expect([cueFrame(0, 30), cueFrame(17_333.333333333332, 30), cueFrame(17_334, 30), cueFrame(10, 30)]).toEqual([
      0, 520, 521, 1,
    ]);
  });

  it("writes events with their nearest frame and a hash of the sound log alone", () => {
    const doc = JSON.parse(eventsDocument(events, { fps: 30, frames: 60, durationMs: 2000, bpm: 90 }));
    expect(doc).toMatchObject({ version: 1, fps: 30, frames: 60, bpm: 90, count: 2 });
    expect(doc.events.map((e: { frame: number }) => e.frame)).toEqual([10, 30]);
    expect(doc.soundLogSha256).toBe(sha256Hex(JSON.stringify(events)));
  });

  it("records settings, cues, programs and an aggregate of the frame hashes", () => {
    const m = buildManifest(manifestInput);
    expect(m).toMatchObject({
      manifestVersion: 1,
      input: { sha256: "ab", blueprintSha256: "c".repeat(64), layers: 3 },
      video: { pixels: [2160, 2160], length: "fixed (--duration)" },
      player: { seed: 7, agents: 8, bpm: 90, controls: false, intro: true, reducedMotion: false },
      cues: [{ spec: "1b:pause", frame: 20, action: "pause" }],
      frames: { count: 2, imageType: "png", aggregateSha256: sha256Hex("1\n2") },
      sound: { bpm: 90, events: 2, soundLogSha256: sha256Hex(JSON.stringify(events)) },
    });
  });

  it("leaves local folders and URL secrets out of the shareable manifest", () => {
    const url = "https://bob:s3cret@files.example.com/deck.md?X-Amz-Signature=abc#t=1";
    const m = buildManifest({
      ...manifestInput,
      argv: ["render", url, "-o", "take.mp4", "--manifest-out", "takes/m.json"],
      manifestFile: path.resolve("/home/alice/work/takes/m.json"),
      input: { arg: url, kind: "file", name: "deck.md", format: "markdown", sha256: "ab", bytes: 2 },
      programs: {
        ...manifestInput.programs,
        browser: { path: path.resolve("/home/alice/bin/chromium"), version: "150" },
      },
      outputs: { video: { path: path.resolve("/home/alice/work/take.mp4"), sha256: "cd", bytes: 3 } },
    });
    const redacted = "https://redacted@files.example.com/deck.md?redacted#redacted";
    expect(m).toMatchObject({
      argv: ["render", redacted, "-o", "take.mp4", "--manifest-out", "takes/m.json"],
      input: { arg: redacted },
      programs: { browser: { name: "chromium", version: "150" }, ffmpeg: null },
      outputs: { video: { path: "../take.mp4", sha256: "cd" } },
    });
    expect(JSON.stringify(m)).not.toMatch(/alice|s3cret|Signature/);
  });
});
