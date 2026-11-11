import type { Player, PlayerOptions, PlayerState, SoundEvent } from "@swarmloom/core";
import { createPlayer as coreCreatePlayer, VirtualClock } from "@swarmloom/core";

/** Playback status after a step. */
export interface SessionStatus {
  state: PlayerState;
  built: number;
  total: number;
  /** The build finished and the tail time has elapsed since. */
  done: boolean;
}

/** A player action at a fixed session time (see {@link RenderSessionOptions.cues}). */
export interface SessionCue {
  /** Session time in ms; the cue applies at the end of the first step that reaches it. */
  at: number;
  /**
   * "pause", "resume", "finish" (complete the build quickly) or "live": go live now, as the
   * toolbar's go live does (an unfinished build completes at once). A "live" cue replaces the
   * automatic go live of {@link RenderSessionOptions.live} and applies even when that is off.
   */
  action: "pause" | "resume" | "finish" | "live";
}

/** Options for {@link RenderSession}. */
export interface RenderSessionOptions {
  /** Player options; the session supplies its own `VirtualClock`. */
  player: Omit<PlayerOptions, "clock">;
  /** Time to keep running after the build completes (finale), ms. Default 0. */
  tailMs?: number;
  /**
   * Go live once the finale settles (player state "done"), as the toolbar's go live does: the
   * cursors leave and the stage turns into the finished page, whose own animations then play on
   * through the rest of the tail. The player goes live at the end of the step that reached "done".
   * Default false (the finale runs through the whole tail).
   */
  live?: boolean;
  /**
   * Player actions at fixed session times, applied in time order (ties in the given order).
   * While paused the session keeps counting time, so {@link RenderSession.soundLog} shifts later
   * events by the paused time and stays aligned with the frames.
   */
  cues?: readonly SessionCue[];
  /** Player factory. Default `createPlayer` from `@swarmloom/core`. */
  createPlayer?: (options: PlayerOptions) => Player;
  /**
   * Called for each player "error" event. The engine reports recoverable problems this way
   * (blueprint diagnostics, a failed layer task, sound) and keeps playing, so they do not stop the
   * session; throw from this callback to make them fatal.
   */
  onWarning?: (error: Error) => void;
}

/** States that mean the build itself has completed. */
const BUILT: ReadonlySet<PlayerState> = new Set(["finale", "done", "live"]);
/** Largest single step; longer jumps would skip choreography and are almost certainly a driver bug. */
export const MAX_STEP_MS = 10_000;
/** Float slack when comparing summed frame steps with cue times. */
const TIME_EPSILON = 1e-6;

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * Deterministic playback on a {@link VirtualClock}: time moves only through {@link step}, and every
 * step waits for `player.ready()` (decoded images and fonts) before it resolves, so a frame captured
 * after a step always shows fully loaded content.
 *
 * Elapsed time is tracked by the session, not read from the clock, because the player may stop its
 * clock (pause, end of build) while the video keeps running through the tail.
 */
export class RenderSession {
  readonly clock = new VirtualClock();
  readonly player: Player;
  readonly tailMs: number;
  readonly #live: boolean;
  #wentLive = false;
  #elapsed = 0;
  #builtAt: number | null = null;
  #error: Error | null = null;
  readonly #warnings: Error[] = [];
  readonly #onWarning: ((error: Error) => void) | undefined;
  #started = false;
  #disposed = false;
  readonly #unsubscribe: (() => void)[];
  readonly #cues: readonly SessionCue[];
  #nextCue = 0;
  /** Session time at which the player was paused by a cue, or null while it runs. */
  #pausedAt: number | null = null;
  /** Sound log shifts: events from index `from` on are moved `shift` ms later (sorted by `from`). */
  readonly #shifts: { from: number; shift: number }[] = [];

  constructor(options: RenderSessionOptions) {
    const tail = options.tailMs ?? 0;
    if (!Number.isFinite(tail) || tail < 0) throw new RangeError(`tailMs must be a finite number >= 0, got ${tail}`);
    this.tailMs = tail;
    this.#cues = [...(options.cues ?? [])].sort((a, b) => a.at - b.at);
    // A live cue sets the go-live time itself.
    this.#live = (options.live ?? false) && !this.#cues.some((cue) => cue.action === "live");
    const bad = this.#cues.find((cue) => !Number.isFinite(cue.at) || cue.at < 0);
    if (bad) throw new RangeError(`cue time must be a finite number >= 0, got ${bad.at}`);
    this.#onWarning = options.onWarning;
    const create = options.createPlayer ?? coreCreatePlayer;
    this.player = create({ ...options.player, clock: this.clock });
    this.#unsubscribe = [
      this.player.on("state", (e) => {
        if (BUILT.has(e.state)) this.#markBuilt();
      }),
      this.player.on("error", (e) => this.#warn(e.error)),
    ];
  }

  /** Engine time covered so far, ms (sum of all steps). */
  get elapsed(): number {
    return this.#elapsed;
  }

  /** Engine time at which the build completed, or null while building. */
  get builtAt(): number | null {
    return this.#builtAt;
  }

  /** Recoverable errors the player reported so far, in order. */
  get warnings(): readonly Error[] {
    return this.#warnings;
  }

  /**
   * Sound events in session time. The player times events in its own time, which stops while it
   * is paused; events after a cued pause are shifted by the paused time so they match the frames.
   */
  get soundLog(): readonly SoundEvent[] {
    const log = this.player.soundLog;
    if (this.#shifts.length === 0) return log;
    let k = -1;
    return log.map((event, i) => {
      while (k + 1 < this.#shifts.length && (this.#shifts[k + 1]?.from ?? Infinity) <= i) k++;
      const shift = k >= 0 ? (this.#shifts[k]?.shift ?? 0) : 0;
      return shift === 0 ? event : { ...event, t: event.t + shift };
    });
  }

  /** Starts the intro and build at time 0 and resolves when the first frame is ready to capture. */
  async start(): Promise<SessionStatus> {
    this.#assertActive();
    if (this.#started) throw new Error("RenderSession already started");
    this.#started = true;
    this.clock.start();
    this.player.play().then(
      () => this.#markBuilt(),
      (error: unknown) => this.#fail(error),
    );
    this.#applyCues();
    return this.#settle();
  }

  /**
   * Advances engine time by `ms` and resolves once the resulting frame is ready.
   *
   * @throws RangeError for a negative, non-finite or over-long step; the reason when `play()` rejected
   *   or `onWarning` threw.
   */
  async step(ms: number): Promise<SessionStatus> {
    this.#assertActive();
    if (!this.#started) throw new Error("Call start() before step()");
    if (!Number.isFinite(ms) || ms < 0 || ms > MAX_STEP_MS) {
      throw new RangeError(`step() needs 0 <= ms <= ${MAX_STEP_MS}, got ${ms}`);
    }
    // Update elapsed first: state listeners fired during advance() read it.
    this.#elapsed += ms;
    this.clock.advance(ms);
    this.#applyCues();
    this.#goLiveWhenDone();
    return this.#settle();
  }

  status(): SessionStatus {
    const { built, total } = this.player.progress;
    // Tolerate float error from summing 1000 / fps steps.
    const done = this.#builtAt !== null && this.#elapsed - this.#builtAt >= this.tailMs - 1e-6;
    return { state: this.player.state, built, total, done };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const off of this.#unsubscribe) off();
    this.clock.stop();
    this.player.destroy();
  }

  async #settle(): Promise<SessionStatus> {
    await this.player.ready();
    if (this.#error) throw this.#error;
    return this.status();
  }

  /** Applies every cue due by the current session time, then records any pause it started or ended. */
  #applyCues(): void {
    for (;;) {
      const cue = this.#cues[this.#nextCue];
      if (!cue || cue.at > this.#elapsed + TIME_EPSILON) break;
      this.#nextCue++;
      // An action that ends a pause may log sounds itself (finish() fans out from the intro); those
      // belong after the hold too, so the shift starts before them.
      const logged = this.player.soundLog.length;
      if (cue.action === "pause") this.player.pause();
      else if (cue.action === "resume") this.player.resume();
      else if (cue.action === "live") this.#goLive();
      else this.player.finish?.();
      // The player ignores actions that do not fit its state, so follow what it actually did.
      const paused = this.player.state === "paused";
      if (paused && this.#pausedAt === null) {
        this.#pausedAt = this.#elapsed;
      } else if (!paused && this.#pausedAt !== null) {
        const before = this.#shifts.at(-1)?.shift ?? 0;
        this.#shifts.push({ from: logged, shift: before + this.#elapsed - this.#pausedAt });
        this.#pausedAt = null;
      }
    }
  }

  /** Goes live once, outside the engine's frame, when the finale has settled. */
  #goLiveWhenDone(): void {
    if (this.#live && this.player.state === "done") this.#goLive();
  }

  #goLive(): void {
    if (this.#wentLive) return;
    this.#wentLive = true;
    this.player.goLive();
  }

  #markBuilt(): void {
    this.#builtAt ??= this.#elapsed;
  }

  #fail(reason: unknown): void {
    this.#error ??= toError(reason);
  }

  #warn(error: Error): void {
    this.#warnings.push(error);
    try {
      this.#onWarning?.(error);
    } catch (reason) {
      this.#fail(reason);
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("RenderSession has been disposed");
  }
}
