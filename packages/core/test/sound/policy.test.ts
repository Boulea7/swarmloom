import { describe, expect, it } from "vitest";
import { EventPolicy } from "../../src/sound/policy";
import { eighthMs } from "../../src/sound/quantize";
import type { SoundEvent } from "../../src/types";

const BPM = 120; // eighth = 250 ms

function policy(voiced: (name: string) => boolean = () => true, beatSync = true): EventPolicy {
  return new EventPolicy({ bpm: BPM, beatSync, voiced });
}

function admitAll(p: EventPolicy, events: SoundEvent[]) {
  return events.map((ev, i) => p.admit(ev, i));
}

describe("EventPolicy", () => {
  it("keeps one note per eighth slot and drops the rest instead of queueing them", () => {
    expect(eighthMs(BPM)).toBe(250);
    const notes = [10, 120, 240, 260, 600].map((t) => ({ t, name: "note", pan: 0 }));
    const result = admitAll(policy(), notes);
    // 10 -> 250; 120 and 240 share that slot and are dropped (not pushed to 500); 260 -> 500; 600 -> 750.
    expect(result.map((r) => r?.at ?? null)).toEqual([250, null, null, 500, 750]);
  });

  it("quantizes musical one-shots but plays mechanical sounds on time", () => {
    const p = policy();
    expect(p.admit({ t: 1010, name: "chord", pan: 0 }, 0)?.at).toBe(1250);
    expect(p.admit({ t: 1010, name: "key", pan: 0 }, 1)?.at).toBe(1010);
    expect(p.admit({ t: 1010, name: "sweep", pan: 0 }, 2)?.at).toBe(1010);
    expect(policy(undefined, false).admit({ t: 1010, name: "note", pan: 0 }, 0)?.at).toBe(1010);
  });

  it("rate-limits dense typing and de-duplicates phrase one-shots", () => {
    const p = policy();
    const keys = Array.from({ length: 40 }, (_, i) => ({ t: i * 2.5, name: "key", pan: 0 }));
    const admitted = admitAll(p, keys).filter(Boolean).length;
    expect(admitted).toBe(6); // 6 per 100 ms window
    expect(p.admit({ t: 200, name: "key", pan: 0 }, 99)).not.toBeNull();
    expect(p.admit({ t: 3000, name: "swell", pan: 0 }, 100)).not.toBeNull();
    expect(p.admit({ t: 3100, name: "swell", pan: 0 }, 101)).toBeNull();
  });

  it("rejects malformed events and names the pack does not voice, and sanitizes values", () => {
    const p = policy((name) => name !== "key");
    expect(p.admit({ t: 0, name: "key", pan: 0 }, 0)).toBeNull();
    expect(p.admit({ t: Number.NaN, name: "pop", pan: 0 }, 1)).toBeNull();
    expect(p.admit({ name: "pop", pan: 0 } as unknown as SoundEvent, 2)).toBeNull();
    expect(p.admit({ t: -5, name: "pop", pan: 9, vel: -1, pitch: Number.NaN }, 3)).toMatchObject({
      at: 0,
      pan: 1,
      vel: 0,
      pitch: undefined,
    });
  });
});
