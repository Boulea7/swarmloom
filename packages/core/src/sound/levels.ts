/** Number of frequency bands reported by {@link LevelMeter}. */
export const BAND_COUNT = 16;

const FFT_SIZE = 1024;
const LOWEST_HZ = 60;
const HIGHEST_HZ = 12000;
/** Loudness mapping: RMS at FLOOR_DB reads 0, at FLOOR_DB + RANGE_DB reads 1. */
const FLOOR_DB = -54;
const RANGE_DB = 48;
/** Smoothing time constants in seconds: quick to rise, slow to fall, like a VU meter. */
const ATTACK_SECONDS = 0.04;
const RELEASE_SECONDS = 0.3;

/** Snapshot returned by {@link LevelMeter.read}; the same object is updated on every read. */
export interface Levels {
  /** Smoothed loudness 0..1. */
  level: number;
  /** Smoothed magnitudes 0..1 of {@link BAND_COUNT} log-spaced bands from 60 Hz to 12 kHz. */
  readonly bands: Float32Array;
}

function smooth(current: number, target: number, dt: number): number {
  const tau = target > current ? ATTACK_SECONDS : RELEASE_SECONDS;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/**
 * Analyses a signal for the halo finale: loudness and band energies, smoothed by elapsed audio
 * time so the result does not depend on how often it is read. Reads allocate nothing.
 */
export class LevelMeter {
  readonly node: AnalyserNode;
  readonly #spectrum: Uint8Array<ArrayBuffer>;
  readonly #wave: Float32Array<ArrayBuffer>;
  /** Inclusive start and exclusive end FFT bin of each band, flattened. */
  readonly #edges: Int32Array;
  readonly #result: Levels = { level: 0, bands: new Float32Array(BAND_COUNT) };
  #lastRead = -1;

  constructor(ctx: BaseAudioContext) {
    const node = ctx.createAnalyser();
    node.fftSize = FFT_SIZE;
    node.smoothingTimeConstant = 0;
    node.minDecibels = -90;
    node.maxDecibels = -20;
    this.node = node;
    this.#spectrum = new Uint8Array(node.frequencyBinCount);
    this.#wave = new Float32Array(FFT_SIZE);
    this.#edges = bandEdges(ctx.sampleRate, node.frequencyBinCount);
  }

  /**
   * @param now Current context time in seconds; reads at an unchanged time (suspended context,
   *   same render quantum) return the previous values.
   * @returns The shared, updated {@link Levels} object.
   */
  read(now: number): Levels {
    const dt = this.#lastRead < 0 ? Number.POSITIVE_INFINITY : now - this.#lastRead;
    if (dt <= 0) return this.#result;
    this.#lastRead = now;

    this.node.getByteFrequencyData(this.#spectrum);
    const { bands } = this.#result;
    for (let b = 0; b < BAND_COUNT; b++) {
      const start = this.#edges[b * 2] ?? 0;
      const end = this.#edges[b * 2 + 1] ?? start + 1;
      let sum = 0;
      for (let i = start; i < end; i++) sum += this.#spectrum[i] ?? 0;
      bands[b] = smooth(bands[b] ?? 0, sum / ((end - start) * 255), dt);
    }

    this.node.getFloatTimeDomainData(this.#wave);
    let energy = 0;
    for (let i = 0; i < this.#wave.length; i++) {
      const s = this.#wave[i] ?? 0;
      energy += s * s;
    }
    const rms = Math.sqrt(energy / this.#wave.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const target = Math.min(1, Math.max(0, (db - FLOOR_DB) / RANGE_DB));
    this.#result.level = smooth(this.#result.level, target, dt);
    return this.#result;
  }

  disconnect(): void {
    this.node.disconnect();
  }
}

/** Log-spaced band edges as FFT bin indices; every band covers at least one bin. */
function bandEdges(sampleRate: number, bins: number): Int32Array {
  const binHz = sampleRate / 2 / bins;
  const edges = new Int32Array(BAND_COUNT * 2);
  const ratio = HIGHEST_HZ / LOWEST_HZ;
  let previousEnd = 1; // skip the DC bin
  for (let b = 0; b < BAND_COUNT; b++) {
    const hiHz = LOWEST_HZ * ratio ** ((b + 1) / BAND_COUNT);
    const start = Math.min(previousEnd, bins - 1);
    const end = Math.min(bins, Math.max(start + 1, Math.round(hiHz / binHz)));
    edges[b * 2] = start;
    edges[b * 2 + 1] = end;
    previousEnd = end;
  }
  return edges;
}
