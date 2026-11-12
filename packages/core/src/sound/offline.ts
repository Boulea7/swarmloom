import type { SoundEvent, SoundOptions } from "../types";
import { offlineContextCtor } from "./audio-context";
import { createMasterBus } from "./bus";
import { type AdmittedEvent, EventPolicy, HIT_EARLY_MS } from "./policy";
import { resolveSettings, type SoundSettings } from "./settings";
import { Synth } from "./synth";

export { encodeWav } from "./wav";

export interface RenderOfflineOptions {
  /** Output sample rate in Hz, 8000..192000. Default 48000. */
  sampleRate?: number;
  /** Output channels (1 or 2). Default 2. */
  channels?: number;
  /** Sound pack id (see `SoundOptions.pack`). Overrides `sound.pack`. */
  pack?: string;
  /** Master volume 0..1. Overrides `sound.volume`. */
  volume?: number;
  /** Grid tempo. Overrides `sound.bpm`. Default 112. */
  bpm?: number;
  /** Seed for per-event humanization; the same seed and events give bit-identical audio. Default 0. */
  seed?: number;
  /**
   * Sound settings as passed to `PlayerOptions.sound`. `false` or `{ enabled: false }` renders
   * silence of the requested length.
   */
  sound?: boolean | Partial<SoundOptions>;
  /**
   * Cancels the render: the promise rejects with the signal's reason at once, no further events are
   * scheduled and the output is cut off, so the rest of the timeline renders as fast silence.
   */
  signal?: AbortSignal;
}

/** Longest render accepted, in ms (10 minutes keeps the float buffer within a few hundred MB). */
export const MAX_RENDER_MS = 10 * 60 * 1000;
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 192000;
/** Events are scheduled in slices of this length while rendering, bounding live audio nodes. */
const SLICE_SECONDS = 2;
/** Each slice is scheduled this long before the render reaches it. */
const SLICE_MARGIN_SECONDS = 0.1;

interface RenderPlan {
  sampleRate: number;
  channels: number;
  length: number;
  enabled: boolean;
  settings: SoundSettings;
}

function plan(durationMs: number, opts: RenderOfflineOptions): RenderPlan {
  if (typeof durationMs !== "number" || !(durationMs > 0) || durationMs > MAX_RENDER_MS) {
    throw new RangeError(`durationMs must be in (0, ${MAX_RENDER_MS}], got ${durationMs}`);
  }
  const sampleRate = opts.sampleRate ?? 48000;
  if (!Number.isInteger(sampleRate) || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
    throw new RangeError(
      `sampleRate must be an integer in [${MIN_SAMPLE_RATE}, ${MAX_SAMPLE_RATE}], got ${sampleRate}`,
    );
  }
  const channels = opts.channels ?? 2;
  if (channels !== 1 && channels !== 2) throw new RangeError(`channels must be 1 or 2, got ${channels}`);
  const sound = typeof opts.sound === "object" && opts.sound !== null ? opts.sound : {};
  const enabled = opts.sound !== false && sound.enabled !== false;
  const settings = resolveSettings({
    pack: opts.pack ?? sound.pack,
    volume: opts.volume ?? sound.volume,
    bpm: opts.bpm ?? sound.bpm,
    beatSync: sound.beatSync,
    seed: opts.seed,
  });
  return { sampleRate, channels, length: Math.ceil((durationMs / 1000) * sampleRate), enabled, settings };
}

/** Runs admission over the time-ordered events; the result is independent of the audio context. */
function admitAll(events: readonly SoundEvent[], settings: SoundSettings): AdmittedEvent[] {
  const { bpm, beatSync, beatHits, pack } = settings;
  const policy = new EventPolicy({ bpm, beatSync, beatHits, voiced: (name) => pack.voices[name] !== undefined });
  const ordered = events
    .map((ev, index) => ({ ev, index }))
    .filter(({ ev }) => typeof ev === "object" && ev !== null && Number.isFinite(ev.t))
    // Stable order by time; ties keep log order (index) so the result never depends on sort internals.
    .sort((a, b) => a.ev.t - b.ev.t || a.index - b.index);
  const admitted: AdmittedEvent[] = [];
  for (const { ev, index } of ordered) {
    const event = policy.admit(ev, index);
    if (event) admitted.push(event);
  }
  return admitted;
}

/**
 * When each event of a sound log is heard in {@link renderOffline}'s output for the same options:
 * engine ms (on the beat grid where beat sync moves it), or null for an event that stays silent (no
 * voice in the pack, over a rate limit, a note sharing its eighth, a one-shot repeated within 400 ms,
 * a hit off the beat with `beatSync: "all"`). Pure and browser-free, so capture tools can log heard
 * times next to the events.
 *
 * @param events Sound events, usually `Player.soundLog`; the result is in the same order.
 * @param opts The pack, tempo and sound settings `renderOffline` gets (sample rate and volume are ignored).
 */
export function soundTimes(events: readonly SoundEvent[], opts: RenderOfflineOptions = {}): (number | null)[] {
  if (!Array.isArray(events)) throw new TypeError("soundTimes() needs an array of sound events");
  const sound = typeof opts.sound === "object" && opts.sound !== null ? opts.sound : {};
  const times: (number | null)[] = events.map(() => null);
  if (opts.sound === false || sound.enabled === false) return times;
  const settings = resolveSettings({
    pack: opts.pack ?? sound.pack,
    bpm: opts.bpm ?? sound.bpm,
    beatSync: sound.beatSync,
  });
  for (const event of admitAll(events, settings)) times[event.index] = event.at;
  return times;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The render was cancelled.", "AbortError");
}

/** Settles as `work` does, or rejects with the signal's reason as soon as it aborts (calling `onAbort`). */
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal | undefined, onAbort: () => void): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(abortReason(signal));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function startRendering(ctx: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Old WebKit returns undefined from startRendering() and only fires `complete`.
    ctx.oncomplete = (e) => resolve(e.renderedBuffer);
    const rendering = ctx.startRendering() as Promise<AudioBuffer> | undefined;
    rendering?.then(resolve, reject);
  });
}

/**
 * Renders a recorded sound event log to audio with an `OfflineAudioContext`, using the same
 * synthesis graph as realtime playback.
 *
 * Used by exports so the soundtrack matches the frames: event `t` values are engine ms and map 1:1
 * to audio time (musical events snap to the same eighth-note grid as live playback). Every random
 * choice (detune, noise offsets, room) comes from seeded PRNGs keyed by event index, so the same
 * events, options and browser produce bit-identical output.
 *
 * @param events Sound events, usually `Player.soundLog` (any order; sorted by `t`). Malformed
 *   entries and events at or after `durationMs` are skipped.
 * @param durationMs Length of the output in ms, at most {@link MAX_RENDER_MS}.
 * @param opts Sample rate, channels, pack, volume, tempo and seed.
 * @returns The rendered buffer, `ceil(durationMs / 1000 * sampleRate)` frames long.
 * @throws RangeError for an invalid duration, sample rate or channel count; Error when the
 *   environment has no `OfflineAudioContext` (outside a browser).
 */
export async function renderOffline(
  events: readonly SoundEvent[],
  durationMs: number,
  opts: RenderOfflineOptions = {},
): Promise<AudioBuffer> {
  if (!Array.isArray(events)) throw new TypeError("renderOffline() needs an array of sound events");
  const { sampleRate, channels, length, enabled, settings } = plan(durationMs, opts);
  const Ctor = offlineContextCtor();
  if (!Ctor) throw new Error("renderOffline() needs OfflineAudioContext (run it in a browser)");
  const { signal } = opts;
  if (signal?.aborted) throw abortReason(signal);

  const ctx = new Ctor(channels, length, sampleRate);
  const bus = createMasterBus(ctx, { volume: settings.volume, muted: false });
  const synth = new Synth(ctx, bus, settings);
  const admitted = enabled ? admitAll(events, settings).filter((ev) => ev.at < durationMs) : [];

  // Events in time order; one the grid moved past the slice end waits in `later` without holding
  // back the events after it, which would otherwise start late, at the next slice's suspend point.
  // Hits may sound up to HIT_EARLY_MS before their time, so the scan looks that far past the end.
  let next = 0;
  let later: AdmittedEvent[] = [];
  const scheduleUntil = (endSeconds: number): void => {
    if (signal?.aborted) return;
    const endMs = endSeconds * 1000;
    const due = (ev: AdmittedEvent): boolean => {
      if (ev.at >= endMs) return false;
      synth.play(ev, ev.at / 1000);
      return true;
    };
    later = later.filter((ev) => !due(ev));
    while (next < admitted.length && admitted[next].t < endMs + HIT_EARLY_MS) {
      const ev = admitted[next++];
      if (!due(ev)) later.push(ev);
    }
  };

  const total = length / sampleRate;
  let sliceError: unknown = null;
  const fail = (error: unknown): void => {
    sliceError ??= error;
  };
  if (typeof ctx.suspend === "function" && total > SLICE_SECONDS) {
    // Schedule slice by slice while rendering so long exports never hold every node at once.
    scheduleUntil(SLICE_SECONDS);
    for (let start = SLICE_SECONDS; start < total; start += SLICE_SECONDS) {
      const sliceStart = start;
      ctx
        .suspend(sliceStart - SLICE_MARGIN_SECONDS)
        .then(() => {
          try {
            scheduleUntil(sliceStart + SLICE_SECONDS);
          } finally {
            // Always resume, or a throwing slice would stall the render forever.
            ctx.resume().catch(fail);
          }
        })
        .catch(fail);
    }
  } else {
    scheduleUntil(Number.POSITIVE_INFINITY);
  }
  // A context cannot stop rendering; once cancelled, the slices resume without scheduling anything
  // and the cut-off bus leaves only silence to render, which ends quickly and frees the context.
  const buffer = await unlessAborted(startRendering(ctx), signal, () => bus.disconnect());
  // A failed slice means missing sounds; an incomplete soundtrack must not pass silently.
  if (sliceError !== null) throw new Error("renderOffline() could not schedule every event", { cause: sliceError });
  return buffer;
}
