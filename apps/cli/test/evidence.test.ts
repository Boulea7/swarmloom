import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { renderPathArgs } from "../src/commands/render";
import { buildManifest, cueFrame, eventsDocument, type ManifestInput, sha256Hex } from "../src/pipeline/evidence";

const events = [
  { t: 333.3333333333333, name: "note", pan: 0.2, pitch: 3, vel: 0.8 },
  { t: 1000, name: "chord", pan: 0 },
];

const manifestInput: ManifestInput = {
  tool: { name: "swarmloom", version: "0.1.0" },
  argv: ["render", "a.svg", "--seed", "7"],
  pathArgs: [],
  cwd: path.resolve("/w"),
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

  it("writes events and scrolls with their frames and a hash of the sound log alone", () => {
    const scroll = { t: 100, end: 400, from: 0, to: 330 };
    const doc = JSON.parse(eventsDocument(events, { fps: 30, frames: 60, durationMs: 2000, bpm: 90 }, [scroll]));
    expect(doc).toMatchObject({ version: 1, fps: 30, frames: 60, bpm: 90, count: 2 });
    expect(doc.events.map((e: { frame: number }) => e.frame)).toEqual([10, 30]);
    expect(doc.scrolls).toEqual([{ ...scroll, frame: 3, endFrame: 12 }]);
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

  it("records file arguments relative to the manifest and programs by name, absolute paths included", () => {
    const work = path.resolve("/home/alice/work");
    const at = (file: string) => path.join(work, file);
    const argv = [at("take.svg"), "-f", "png-seq", `-o${at("frames")}`, "--events-out", "ev/e.json"];
    argv.push(`--manifest-out=${at("takes/m.json")}`, "--chrome", path.resolve("/home/alice/bin/chromium"));
    const m = buildManifest({
      ...manifestInput,
      argv: ["render", ...argv, "--seed", "7"],
      pathArgs: renderPathArgs([...argv, "--seed", "7"]),
      cwd: work,
      manifestFile: at("takes/m.json"),
      input: { ...manifestInput.input, arg: pathToFileURL(at("take.svg")).href },
    });
    // Inside the manifest's folder or above it: relative; elsewhere (ev/, bin/): the name alone.
    const shared = ["../take.svg", "-f", "png-seq", "-o../frames", "--events-out", "e.json", "--manifest-out=m.json"];
    expect(m).toMatchObject({
      argv: ["render", ...shared, "--chrome", "chromium", "--seed", "7"],
      input: { arg: "../take.svg" },
    });
    expect(JSON.stringify(m)).not.toMatch(/alice/);
  });
});
