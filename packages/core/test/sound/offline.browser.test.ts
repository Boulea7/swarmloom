import { describe, expect, it } from "vitest";
import { createMasterBus, LIMIT_CEILING } from "../../src/sound/bus";
import { MAX_RENDER_MS, renderOffline } from "../../src/sound/offline";
import { PACK_IDS } from "../../src/sound/packs";
import { DEFAULT_BPM, quantize } from "../../src/sound/quantize";
import { encodeWav } from "../../src/sound/wav";
import type { SoundEvent } from "../../src/types";

const RATE = 48000;

/** Largest absolute sample over all channels in [fromMs, toMs). */
function peak(buffer: AudioBuffer, fromMs: number, toMs: number): number {
  const from = Math.max(0, Math.floor((fromMs / 1000) * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.ceil((toMs / 1000) * buffer.sampleRate));
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = from; i < to; i++) max = Math.max(max, Math.abs(data[i]));
  }
  return max;
}

function sameSamples(a: AudioBuffer, b: AudioBuffer): boolean {
  if (a.length !== b.length || a.numberOfChannels !== b.numberOfChannels) return false;
  for (let c = 0; c < a.numberOfChannels; c++) {
    const x = new Uint32Array(a.getChannelData(c).buffer);
    const y = new Uint32Array(b.getChannelData(c).buffer);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

/** One of every event, spread over 5 s so the render crosses scheduling slices. */
const SHOWCASE: SoundEvent[] = [
  { t: 0, name: "swell", pan: 0 },
  { t: 400, name: "fanout", pan: 0 },
  ...Array.from({ length: 30 }, (_, i): SoundEvent => ({ t: 900 + i * 37, name: i % 6 ? "key" : "space", pan: -0.5 })),
  { t: 2000, name: "press", pan: 0.4 },
  { t: 2070, name: "release", pan: 0.4 },
  { t: 2200, name: "pen", pan: 0.1 },
  { t: 2300, name: "snap", pan: -0.2 },
  ...Array.from({ length: 4 }, (_, i): SoundEvent => ({ t: 2400 + i * 60, name: "tick", pan: 0, pitch: i })),
  ...Array.from(
    { length: 8 },
    (_, i): SoundEvent => ({ t: 2700 + i * 150, name: "note", pan: i / 4 - 1, pitch: i / 8 }),
  ),
  { t: 3900, name: "chord", pan: 0 },
  { t: 4600, name: "sweep", pan: 0 },
  { t: 4700, name: "pop", pan: 0.3 },
];

describe("renderOffline", () => {
  it("is audible around event times and silent elsewhere, with notes on the beat grid", async () => {
    const noteAt = quantize(3000, DEFAULT_BPM); // ~3214 ms
    const buffer = await renderOffline(
      [
        { t: 500, name: "key", pan: -0.6, vel: 1 },
        { t: 3000, name: "note", pan: 0.2, pitch: 0.4, vel: 1 },
      ],
      6000,
      { sampleRate: RATE },
    );
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(6 * RATE);
    expect(peak(buffer, 0, 495)).toBe(0);
    expect(peak(buffer, 500, 600)).toBeGreaterThan(0.01);
    // The key and its room tail are gone long before the note, which waits for its grid line.
    expect(peak(buffer, 2300, noteAt - 1)).toBeLessThan(1e-4);
    expect(peak(buffer, noteAt + 5, noteAt + 400)).toBeGreaterThan(0.02);
  });

  it("renders bit-identical audio for the same events and seed", async () => {
    const first = await renderOffline(SHOWCASE, 5000, { sampleRate: RATE, seed: 42 });
    const second = await renderOffline(SHOWCASE, 5000, { sampleRate: RATE, seed: 42 });
    const reseeded = await renderOffline(SHOWCASE, 5000, { sampleRate: RATE, seed: 43 });
    expect(peak(first, 0, 5000)).toBeGreaterThan(0.05);
    expect(peak(first, 0, 5000)).toBeLessThanOrEqual(1);
    expect(sameSamples(first, second)).toBe(true);
    expect(sameSamples(first, reseeded)).toBe(false);
    expect(encodeWav(first).byteLength).toBe(44 + first.length * 4);
  });

  it("voices musical events in every pack and keyboard sounds only where the pack has them", async () => {
    for (const pack of PACK_IDS) {
      const notes = await renderOffline([{ t: 0, name: "note", pan: 0 }], 800, { pack, sampleRate: RATE });
      expect(peak(notes, 0, 800), pack).toBeGreaterThan(0.01);
      const keys = await renderOffline([{ t: 0, name: "key", pan: 0 }], 300, { pack, sampleRate: RATE });
      expect(peak(keys, 0, 300) > 0, pack).toBe(pack !== "silent-keys");
    }
  });

  it("renders silence when sound is off, and mono when asked", async () => {
    const off = await renderOffline(SHOWCASE, 1000, { sampleRate: RATE, sound: { enabled: false } });
    expect(peak(off, 0, 1000)).toBe(0);
    const mono = await renderOffline(SHOWCASE, 1000, { sampleRate: 22050, channels: 1 });
    expect(mono.numberOfChannels).toBe(1);
    expect(mono.sampleRate).toBe(22050);
    expect(peak(mono, 0, 1000)).toBeGreaterThan(0.01);
  });

  it("rejects invalid durations, formats and event lists", async () => {
    await expect(renderOffline([], 0)).rejects.toThrow(RangeError);
    await expect(renderOffline([], Number.NaN)).rejects.toThrow(RangeError);
    await expect(renderOffline([], MAX_RENDER_MS + 1)).rejects.toThrow(RangeError);
    await expect(renderOffline([], 100, { sampleRate: 1000 })).rejects.toThrow(RangeError);
    await expect(renderOffline([], 100, { channels: 3 })).rejects.toThrow(RangeError);
    await expect(renderOffline("events" as never, 100)).rejects.toThrow(TypeError);
  });
});

describe("master bus limiter", () => {
  it("keeps a far too loud input below -1 dBFS at full volume", async () => {
    const ctx = new OfflineAudioContext(1, RATE / 2, RATE);
    const bus = createMasterBus(ctx, { volume: 1, muted: false });
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const level = ctx.createGain();
    level.gain.value = 8;
    osc.connect(level).connect(bus.input);
    osc.start(0);
    const out = await ctx.startRendering();
    expect(peak(out, 0, 500)).toBeGreaterThan(0.5);
    expect(peak(out, 0, 500)).toBeLessThan(LIMIT_CEILING);
  });
});

describe("master bus mute", () => {
  it("fades out and back in without clicks, even when toggled mid-ramp", async () => {
    const ctx = new OfflineAudioContext(1, RATE, RATE);
    const bus = createMasterBus(ctx, { volume: 1, muted: false });
    const osc = ctx.createOscillator();
    osc.frequency.value = 220;
    const level = ctx.createGain();
    level.gain.value = 0.5;
    osc.connect(level).connect(bus.input);
    osc.start(0);
    bus.setMuted(true, 0.3);
    bus.setMuted(false, 0.31); // reverse while the fade is still running
    bus.setMuted(true, 0.6);
    const out = await ctx.startRendering();
    const data = out.getChannelData(0);

    const maxStep = (fromMs: number, toMs: number): number => {
      let max = 0;
      for (let i = Math.floor((fromMs / 1000) * RATE) + 1; i < (toMs / 1000) * RATE; i++) {
        max = Math.max(max, Math.abs(data[i] - data[i - 1]));
      }
      return max;
    };
    // A steady sine changes by at most 2*pi*f*A/rate per sample; a click is a jump far above that.
    const natural = maxStep(100, 300);
    expect(natural).toBeGreaterThan(0.001);
    expect(maxStep(0, 1000)).toBeLessThanOrEqual(natural * 1.05);
    expect(peak(out, 100, 300)).toBeGreaterThan(0.05);
    expect(peak(out, 480, 600)).toBeGreaterThan(0.05); // back in after the reversal
    expect(peak(out, 760, 1000)).toBeLessThan(1e-3); // muted at the end
  });
});
