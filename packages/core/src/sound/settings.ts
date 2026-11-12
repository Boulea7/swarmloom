import { DEFAULT_VOLUME } from "./bus";
import { resolvePack } from "./packs";
import { DEFAULT_BPM, MAX_BPM, MIN_BPM } from "./quantize";
import { clamp } from "./scale";
import type { SoundPack } from "./voice";

/** Sound settings as accepted from callers (all optional, untrusted values). */
export interface SoundSettingsInput {
  pack?: string;
  volume?: number;
  bpm?: number;
  beatSync?: boolean | "all";
  seed?: number;
}

/** Validated settings shared by realtime playback and offline rendering. */
export interface SoundSettings {
  readonly pack: SoundPack;
  readonly volume: number;
  readonly bpm: number;
  readonly beatSync: boolean;
  /** Hits snap to sixteenth notes too (`beatSync: "all"`). */
  readonly beatHits: boolean;
  readonly seed: number;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Normalizes caller settings: unknown packs fall back to the default pack, volume is clamped to
 * 0..1, tempo to {@link MIN_BPM}..{@link MAX_BPM}, and the seed is coerced to an unsigned 32-bit
 * integer. Invalid values fall back to the defaults instead of failing playback.
 */
export function resolveSettings(input: SoundSettingsInput = {}): SoundSettings {
  const volume = finite(input.volume);
  const bpm = finite(input.bpm);
  const seed = finite(input.seed);
  return {
    pack: resolvePack(typeof input.pack === "string" ? input.pack : undefined),
    volume: volume === undefined ? DEFAULT_VOLUME : clamp(volume, 0, 1),
    bpm: bpm === undefined ? DEFAULT_BPM : clamp(bpm, MIN_BPM, MAX_BPM),
    beatSync: input.beatSync !== false,
    beatHits: input.beatSync === "all",
    seed: seed === undefined ? 0 : seed >>> 0,
  };
}
