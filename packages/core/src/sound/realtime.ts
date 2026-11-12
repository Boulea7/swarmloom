import type { SoundEngine } from "../internal";
import type { SoundEvent, SoundOptions } from "../types";
import { createRealtimeContext } from "./audio-context";
import { createMasterBus, type MasterBus, MUTE_TIME_CONSTANT } from "./bus";
import { LevelMeter, type Levels } from "./levels";
import { defaultMicrophoneSource, MicrophoneInput, type MicrophoneSource } from "./microphone";
import { EventPolicy } from "./policy";
import { resolveSettings, type SoundSettings } from "./settings";
import { Synth } from "./synth";

/** Scheduling lead in seconds: events start this far after "now" so the audio thread never misses them. */
const LEAD_SECONDS = 0.03;
/** Re-anchor the engine->audio time map when an event would land outside this window after "now". */
const MIN_LEAD_SECONDS = 0.005;
const MAX_LEAD_SECONDS = 0.12;
/** An event this far behind the previous one means a new timeline (replay): reset grid state. */
const TIMELINE_RESET_MS = 250;
/** Time for the mute fade to settle below -60 dB (about 7 time constants). */
const MUTE_SETTLE_SECONDS = MUTE_TIME_CONSTANT * 7;
/** Suspend the context this long after muting (no mic) so an idle muted player costs no CPU. */
const IDLE_SUSPEND_MS = 1500;
/** `unlock()` stops waiting for `resume()` after this long (it never settles without a gesture). */
const UNLOCK_TIMEOUT_MS = 500;
/** Delay between the final fade and closing the context on destroy, so closing does not click. */
const CLOSE_DELAY_MS = 80;
/** Any of these on the page counts as the user gesture that lets audio start. */
const GESTURES = ["pointerdown", "mousedown", "touchend", "keydown"] as const;

/** Environment hooks, injectable for tests and non-window hosts. */
export interface RealtimeSoundDeps {
  /** Creates the context; default: a low-latency `AudioContext`, or null without Web Audio. */
  createContext?: () => AudioContext | null;
  /** Receives the unlock gesture listeners; default `globalThis` when it is an event target. */
  gestureTarget?: EventTarget | null;
  /** Microphone access; default `navigator.mediaDevices` when available. */
  microphone?: MicrophoneSource | null;
}

/** Optional extras on top of the {@link SoundOptions} contract. */
export interface RealtimeSoundOptions extends SoundOptions {
  /** Seed for per-event humanization (detune, noise offsets). Default 0. */
  seed?: number;
}

/**
 * Maps engine milliseconds onto the audio clock. Relative timing between events is preserved
 * (notes keep their grid positions); the anchor moves whenever an event would fall in the past or
 * too far ahead, which covers pauses, dropped frames and replays.
 */
class AudioClockMap {
  #engineMs = 0;
  #audioSeconds = 0;
  #anchored = false;

  toAudio(t: number, at: number, now: number): number {
    const raw = this.#audioSeconds + (t - this.#engineMs) / 1000;
    if (!this.#anchored || raw < now + MIN_LEAD_SECONDS || raw > now + MAX_LEAD_SECONDS) {
      this.#engineMs = t;
      this.#audioSeconds = now + LEAD_SECONDS;
      this.#anchored = true;
    }
    return this.#audioSeconds + (at - this.#engineMs) / 1000;
  }
}

/** Audio graph that exists once the context does. */
interface Graph {
  readonly ctx: AudioContext;
  readonly bus: MasterBus;
  readonly synth: Synth;
  readonly meter: LevelMeter;
}

function defaultGestureTarget(): EventTarget | null {
  return typeof globalThis.addEventListener === "function" ? (globalThis as unknown as EventTarget) : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Time order for admission; ties keep emission order (the sort is stable). */
function byTime(a: SoundEvent, b: SoundEvent): number {
  return a.t - b.t;
}

/**
 * Realtime WebAudio sound engine. See {@link createSound}.
 *
 * Admission order: the engine emits a frame's sounds agent by agent, so a later agent can sound
 * earlier in the frame than one before it. Events played in one task are therefore admitted
 * together once it ends, in time order (ties in emission order), as offline rendering admits the
 * whole log, so the order-sensitive policy (beat hit lines, rate windows) makes the same choices.
 *
 * Lock model: `locked` is true while sound is wanted (enabled, or the microphone is on) but the
 * context is not running, typically because of the autoplay policy. Events arriving while locked
 * are dropped, except that the latest `chord` is kept and played on unlock (a later `sweep`
 * discards it), so a user who taps for sound after the build still hears it complete.
 */
class RealtimeSound implements SoundEngine {
  readonly #settings: SoundSettings;
  readonly #deps: Required<RealtimeSoundDeps>;
  readonly #lockListeners = new Set<(locked: boolean) => void>();
  readonly #clock = new AudioClockMap();
  #graph: Graph | null = null;
  #policy: EventPolicy;
  #enabled: boolean;
  #destroyed = false;
  #reportedLocked = false;
  #gesturesAttached = false;
  #selfSuspended = false;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingChord: SoundEvent | null = null;
  /** Events of the current task, admitted in time order when it ends (see {@link #flush}). */
  #batch: SoundEvent[] = [];
  #flushQueued = false;
  #eventIndex = 0;
  #lastEventMs = Number.NEGATIVE_INFINITY;
  #mic: MicrophoneInput | null = null;
  #micRequest = 0;

  constructor(options: RealtimeSoundOptions, deps: RealtimeSoundDeps) {
    this.#settings = resolveSettings(options);
    this.#deps = {
      createContext: deps.createContext ?? createRealtimeContext,
      gestureTarget: deps.gestureTarget === undefined ? defaultGestureTarget() : deps.gestureTarget,
      microphone: deps.microphone === undefined ? defaultMicrophoneSource() : deps.microphone,
    };
    this.#policy = this.#newPolicy();
    this.#enabled = options.enabled !== false;
    if (this.#enabled) this.#ensureGraph();
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get locked(): boolean {
    const graph = this.#graph;
    if (!graph || this.#destroyed || this.#selfSuspended) return false;
    if (!this.#enabled && !this.#mic) return false;
    const state = graph.ctx.state as AudioContextState | "interrupted";
    return state !== "running" && state !== "closed";
  }

  play(ev: SoundEvent): void {
    if (this.#destroyed || !this.#enabled || !this.#graph || typeof ev !== "object" || ev === null) return;
    if (this.locked) {
      if (ev.name === "chord") this.#pendingChord = ev;
      else if (ev.name === "sweep") this.#pendingChord = null;
      return;
    }
    // A jump back is a new timeline (replay): the old one's events must not sort after it.
    const last = this.#batch[this.#batch.length - 1];
    if (last && ev.t < last.t - TIMELINE_RESET_MS) this.#flush();
    this.#batch.push(ev);
    if (!this.#flushQueued) {
      this.#flushQueued = true;
      queueMicrotask(this.#flush);
    }
  }

  setEnabled(on: boolean): void {
    const enabled = Boolean(on);
    if (this.#destroyed || enabled === this.#enabled) return;
    this.#enabled = enabled;
    if (enabled) {
      const graph = this.#ensureGraph();
      if (graph) {
        this.#wake(graph);
        graph.bus.setMuted(false, graph.ctx.currentTime);
      }
    } else {
      this.#pendingChord = null;
      const graph = this.#graph;
      if (graph) {
        const now = graph.ctx.currentTime;
        graph.bus.setMuted(true, now);
        // Once the fade is done, stop what is still ringing so unmuting never revives old tails.
        graph.synth.stopAll(now + MUTE_SETTLE_SECONDS);
        this.#scheduleIdleSuspend();
      }
    }
    this.#updateLock();
  }

  async unlock(): Promise<void> {
    if (this.#destroyed) return;
    const graph = this.#ensureGraph();
    if (!graph || graph.ctx.state === "running") return;
    this.#selfSuspended = false;
    this.#kick(graph.ctx);
    await Promise.race([graph.ctx.resume().catch(() => undefined), delay(UNLOCK_TIMEOUT_MS)]);
    this.#updateLock();
  }

  onLockChange(fn: (locked: boolean) => void): () => void {
    this.#lockListeners.add(fn);
    return () => {
      this.#lockListeners.delete(fn);
    };
  }

  levels(): Levels | null {
    const graph = this.#graph;
    if (this.#destroyed || !graph) return null;
    const meter = this.#mic ? this.#mic.meter : graph.meter;
    return meter.read(graph.ctx.currentTime);
  }

  async useMicrophone(on: boolean): Promise<boolean> {
    const request = ++this.#micRequest;
    if (!on || this.#destroyed) {
      this.#stopMicrophone();
      return false;
    }
    if (this.#mic) return true;
    const devices = this.#deps.microphone;
    const graph = this.#ensureGraph();
    if (!devices || !graph) return false;
    const mic = await MicrophoneInput.open(graph.ctx, devices, () => {
      if (this.#mic === mic) this.#stopMicrophone();
    });
    if (!mic) return false;
    // A later call (off, or destroy) superseded this one while the permission prompt was open.
    if (request !== this.#micRequest || this.#destroyed) {
      mic.stop();
      return false;
    }
    this.#mic = mic;
    this.#wake(graph);
    this.#updateLock();
    return true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#micRequest++;
    this.#stopMicrophone();
    this.#destroyed = true;
    this.#pendingChord = null;
    this.#batch = [];
    this.#clearIdleTimer();
    this.#setGestures(false);
    this.#lockListeners.clear();
    const graph = this.#graph;
    this.#graph = null;
    if (!graph) return;
    graph.ctx.removeEventListener("statechange", this.#onStateChange);
    const close = () => {
      graph.ctx.close().catch(() => undefined);
    };
    if (graph.ctx.state === "running") {
      graph.bus.setMuted(true, graph.ctx.currentTime);
      setTimeout(close, CLOSE_DELAY_MS);
    } else {
      close();
    }
  }

  #newPolicy(): EventPolicy {
    const { bpm, beatSync, beatHits, pack } = this.#settings;
    return new EventPolicy({ bpm, beatSync, beatHits, voiced: (name) => pack.voices[name] !== undefined });
  }

  /** Admits the batched events in time order; drops them when sound went off meanwhile. */
  readonly #flush = (): void => {
    this.#flushQueued = false;
    const batch = this.#batch;
    this.#batch = [];
    const graph = this.#graph;
    if (this.#destroyed || !this.#enabled || !graph) return;
    // Non-finite times are never admitted; leaving them out keeps the comparator consistent.
    for (const ev of batch.filter((e) => Number.isFinite(e.t)).sort(byTime)) this.#schedule(graph, ev);
  };

  #schedule(graph: Graph, ev: SoundEvent): void {
    if (typeof ev.t === "number" && ev.t < this.#lastEventMs - TIMELINE_RESET_MS) this.#policy = this.#newPolicy();
    const admitted = this.#policy.admit(ev, this.#eventIndex++);
    if (!admitted) return;
    this.#lastEventMs = admitted.t;
    graph.synth.play(admitted, this.#clock.toAudio(admitted.t, admitted.at, graph.ctx.currentTime));
  }

  #ensureGraph(): Graph | null {
    if (this.#graph || this.#destroyed) return this.#graph;
    const ctx = this.#deps.createContext();
    if (!ctx) return null;
    try {
      const bus = createMasterBus(ctx, { volume: this.#settings.volume, muted: !this.#enabled });
      const meter = new LevelMeter(ctx);
      bus.tap.connect(meter.node);
      const synth = new Synth(ctx, bus, this.#settings);
      this.#graph = { ctx, bus, synth, meter };
    } catch {
      // A partially supported engine: stay silent rather than break playback.
      ctx.close().catch(() => undefined);
      return null;
    }
    ctx.addEventListener("statechange", this.#onStateChange);
    this.#updateLock();
    return this.#graph;
  }

  /**
   * Tries to (re)start the context when sound is wanted again. After an idle suspend this simply
   * resumes; otherwise it succeeds when the page already has user activation (or we are inside a
   * gesture) and stays pending, reported as locked, until a gesture arrives.
   */
  #wake(graph: Graph): void {
    this.#clearIdleTimer();
    if (graph.ctx.state === "running") return;
    graph.ctx
      .resume()
      .catch(() => undefined)
      .finally(() => {
        this.#selfSuspended = false;
        this.#updateLock();
      });
  }

  #scheduleIdleSuspend(): void {
    this.#clearIdleTimer();
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = null;
      const graph = this.#graph;
      if (!graph || this.#enabled || this.#mic || graph.ctx.state !== "running") return;
      this.#selfSuspended = true;
      graph.ctx.suspend().then(
        // Sound was re-enabled while the suspend was in flight.
        () => {
          if (!this.#destroyed && (this.#enabled || this.#mic)) this.#wake(graph);
        },
        () => undefined,
      );
    }, IDLE_SUSPEND_MS);
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer !== null) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  #stopMicrophone(): void {
    const mic = this.#mic;
    if (!mic) return;
    this.#mic = null;
    mic.stop();
    if (!this.#enabled && !this.#destroyed) this.#scheduleIdleSuspend();
    this.#updateLock();
  }

  readonly #onStateChange = (): void => {
    this.#updateLock();
  };

  readonly #onGesture = (): void => {
    const graph = this.#graph;
    if (!graph || this.#destroyed || graph.ctx.state === "running") return;
    this.#kick(graph.ctx);
    graph.ctx.resume().catch(() => undefined);
  };

  /** Starts a one-sample silent buffer: older iOS Safari only unlocks after a source plays in a gesture. */
  #kick(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start();
      src.onended = () => src.disconnect();
    } catch {
      // Best effort only.
    }
  }

  #updateLock(): void {
    if (this.#destroyed) return;
    const locked = this.locked;
    this.#setGestures(locked);
    if (locked === this.#reportedLocked) return;
    this.#reportedLocked = locked;
    if (!locked) this.#flushPendingChord();
    for (const fn of [...this.#lockListeners]) {
      try {
        fn(locked);
      } catch {
        // A failing listener must not stop the others or the audio engine.
      }
    }
  }

  #flushPendingChord(): void {
    const chord = this.#pendingChord;
    this.#pendingChord = null;
    const graph = this.#graph;
    if (chord && graph && this.#enabled && graph.ctx.state === "running") this.#schedule(graph, chord);
  }

  #setGestures(on: boolean): void {
    const target = this.#deps.gestureTarget;
    if (!target || on === this.#gesturesAttached) return;
    this.#gesturesAttached = on;
    for (const type of GESTURES) {
      if (on) target.addEventListener(type, this.#onGesture, { capture: true, passive: true });
      else target.removeEventListener(type, this.#onGesture, { capture: true });
    }
  }
}

/**
 * Creates the realtime sound engine: WebAudio synthesis (no audio files) through a master bus with
 * a gentle compressor and a generated short room, per-event stereo pan, smooth mute ramps,
 * autoplay-lock detection with unlock from any page gesture, and level analysis for the halo.
 *
 * Never throws for missing Web Audio: without it the engine is silent, `locked` stays false and
 * `levels()` returns null.
 *
 * @param options Sound options (enabled, volume, pack, bpm, beatSync).
 * @param deps Environment hooks; defaults suit a browser page.
 * @throws TypeError when `options` is not an object.
 */
export function createSound(options: RealtimeSoundOptions, deps: RealtimeSoundDeps = {}): SoundEngine {
  if (typeof options !== "object" || options === null) throw new TypeError("createSound() needs a SoundOptions object");
  return new RealtimeSound(options, deps);
}
