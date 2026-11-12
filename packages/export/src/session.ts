import type { Player, PlayerOptions, PlayerState, SoundEvent } from "@swarmloom/core";
import { createPlayer as coreCreatePlayer, VirtualClock } from "@swarmloom/core";

/** Playback status after a step. */
export interface SessionStatus {
  state: PlayerState;
  built: number;
  total: number;
  /**
   * The build finished and the tail time has elapsed since, and a go live under way has shown the
   * page (see {@link RenderSessionOptions.tailMs}).
   */
  done: boolean;
}

/** A player action at a fixed session time (see {@link RenderSessionOptions.cues}). */
export interface SessionCue {
  /**
   * Session time in ms; the cue applies at the end of the first step reaching it (with `tickRate`, the
   * first tick, whole or short: see {@link RenderSessionOptions.tickRate}).
   */
  at: number;
  /**
   * "pause", "resume", "finish" (complete the build quickly), "live": go live now, as the
   * toolbar's go live does (an unfinished build completes at once), or "speed": `Player.setSpeed`
   * with {@link speed}. A "live" cue replaces the automatic go live of
   * {@link RenderSessionOptions.live} and applies even when that is off.
   */
  action: "pause" | "resume" | "finish" | "live" | "speed";
  /** Build speed a "speed" cue sets (finite, > 0); ignored by the other actions. */
  speed?: number;
}

/** One stretch of scrolling in session time (see {@link RenderSession.scrollLog}). */
export interface SessionScroll {
  /** Session time of the last step before the view moved, ms. */
  t: number;
  /** Session time of the first step that showed the view at `to`, ms. */
  end: number;
  /** Top edge of the view before and after, stage px (`Player.scrollY`). */
  from: number;
  to: number;
}

/** Options for {@link RenderSession}. */
export interface RenderSessionOptions {
  /** Player options; the session supplies its own `VirtualClock`. */
  player: Omit<PlayerOptions, "clock">;
  /**
   * Time to keep running after the build completes (finale), ms. Default 0. A go live (automatic or
   * cued) still under way when it ends holds the end until the stage shows the page
   * (`PlayerOptions.onLive`), so a video never stops mid-glide (`liveTop`) or with cursors leaving;
   * a stage that never reports live is given up on 2.5 s after go live.
   */
  tailMs?: number;
  /**
   * Go live once the finale settles (player state "done"), as the toolbar's go live does: the
   * cursors leave and the stage turns into the finished page, whose own animations then play on
   * through the rest of the tail. The player goes live at the end of the step (tick, with
   * `tickRate`) that reached "done". Default false (the finale runs through the whole tail).
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
  /**
   * Engine ticks per second (1..1000). Each {@link RenderSession.step} then advances the clock in
   * ticks that end at the times `k * 1000 / tickRate`, plus a short tick to the step's end when that
   * is not one of them, and every tick waits for `player.ready()`. The engine calls cursors in,
   * hands out tasks and moves the camera once per tick, so with a fixed rate every frame rate that
   * divides it samples the same build; cues and go live then apply at the end of a tick, not of a
   * step. At a frame rate that does not divide it the short ticks are ticks too: a cue due by a frame
   * time applies there, and the sounds logged in a short tick carry its end, so that build differs.
   * Only a step's last tick repaints the cursor canvas (the others pass `draw: false` to
   * `VirtualClock.advance`): the frame is captured after it. Default: none, one tick per step.
   */
  tickRate?: number;
}

/** States that mean the build itself has completed. */
const BUILT: ReadonlySet<PlayerState> = new Set(["finale", "done", "live"]);
/** Largest single step; longer jumps would skip choreography and are almost certainly a driver bug. */
export const MAX_STEP_MS = 10_000;
/** Float slack when comparing summed frame steps with cue and tick times. */
const TIME_EPSILON = 1e-6;
/**
 * Engine ticks per second of the CLI's and Studio's exports (`RenderSessionOptions.tickRate`), the
 * rate of the engine's physics step: frame rates that divide 120 (24, 30, 60, ...) show one build.
 */
export const ENGINE_TICK_RATE = 120;

/** Session time of tick boundary `k`, computed as the CLI computes frame times so the deltas match. */
function tickTime(k: number, rate: number): number {
  return (k * 1000) / rate;
}

/**
 * Longest wait, from go live, for the stage to show the page once the tail is over: the glide back
 * to the top (`liveTop`) takes at most 1.2 s and an overlay stage then fades out for about 0.5 s.
 */
const GO_LIVE_LIMIT_MS = 2500;

/** The view counts as moved between two steps when its top edge moved by more than this, px. */
const SCROLL_EPSILON = 1e-3;

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
  /** Session time the session went live (automatically or at a cue), or null. */
  #liveAt: number | null = null;
  /** The stage shows the live page (`PlayerOptions.onLive` ran). */
  #liveShown = false;
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
  readonly #tickRate: number | undefined;
  /** Index of the last tick boundary at or before the session time. */
  #tick = 0;
  /** The session time is the tick boundary `#tick` exactly (no short tick since). */
  #aligned = true;
  readonly #scrolls: SessionScroll[] = [];
  /** The stretch of scrolling the last step was part of, or null when the view stood still. */
  #scroll: SessionScroll | null = null;
  /** Top edge of the view after the last step (NaN when the player does not report it). */
  #scrollY = Number.NaN;

  constructor(options: RenderSessionOptions) {
    const tail = options.tailMs ?? 0;
    if (!Number.isFinite(tail) || tail < 0) throw new RangeError(`tailMs must be a finite number >= 0, got ${tail}`);
    this.tailMs = tail;
    this.#cues = [...(options.cues ?? [])].sort((a, b) => a.at - b.at);
    // A live cue sets the go-live time itself.
    this.#live = (options.live ?? false) && !this.#cues.some((cue) => cue.action === "live");
    const bad = this.#cues.find((cue) => !Number.isFinite(cue.at) || cue.at < 0);
    if (bad) throw new RangeError(`cue time must be a finite number >= 0, got ${bad.at}`);
    const slow = this.#cues.find(
      (cue) => cue.action === "speed" && !(Number.isFinite(cue.speed) && (cue.speed as number) > 0),
    );
    if (slow) throw new RangeError(`a speed cue needs a finite speed > 0, got ${slow.speed}`);
    this.#onWarning = options.onWarning;
    const rate = options.tickRate;
    if (rate !== undefined && !(rate >= 1 && rate <= 1000)) {
      throw new RangeError(`tickRate must be within 1..1000, got ${rate}`);
    }
    this.#tickRate = rate;
    const create = options.createPlayer ?? coreCreatePlayer;
    const onLive = options.player.onLive;
    this.player = create({
      ...options.player,
      clock: this.clock,
      onLive: () => {
        this.#liveShown = true;
        onLive?.();
      },
    });
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

  /**
   * Every stretch of scrolling so far, in session time (the view is the player's, `Player.scrollY`):
   * the tour following the build, a go-live glide. A stretch runs from the last step before the view
   * moved to the first step that showed it where it stopped; one still moving at the last step ends
   * there.
   * Empty for a player that does not report its scroll position.
   */
  get scrollLog(): readonly SessionScroll[] {
    return this.#scroll ? [...this.#scrolls, { ...this.#scroll }] : this.#scrolls;
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
    this.#scrollY = this.#readScroll();
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
    const rate = this.#tickRate;
    if (rate === undefined) this.#advance(ms, this.#elapsed + ms);
    else await this.#advanceTicks(ms, rate);
    // Once per step: the scroll log is on the frames' clock.
    this.#trackScroll(ms);
    return this.#settle();
  }

  /**
   * Advances by `ms` in ticks of `rate`, waiting for the player between them (not after the last).
   * Only the last tick draws: the step's frame shows what it leaves.
   */
  async #advanceTicks(ms: number, rate: number): Promise<void> {
    const end = this.#elapsed + ms;
    let ticks = 0;
    for (let next = tickTime(this.#tick + 1, rate); next <= end + TIME_EPSILON; next = tickTime(this.#tick + 1, rate)) {
      if (ticks++ > 0) await this.#settle();
      // A whole tick spans the same times at every frame rate, so the engine gets the same deltas.
      // It is the last unless a later tick, whole or short, reaches the end.
      const last = end <= next + TIME_EPSILON;
      this.#advance(next - (this.#aligned ? tickTime(this.#tick, rate) : this.#elapsed), next, last);
      this.#tick++;
      this.#aligned = true;
    }
    // A frame time between two ticks (a frame rate that does not divide the tick rate) gets a short tick.
    const short = end > this.#elapsed + TIME_EPSILON;
    if (short || ticks === 0) {
      if (ticks > 0) await this.#settle();
      this.#advance(Math.max(0, end - this.#elapsed), Math.max(end, this.#elapsed));
      if (short) this.#aligned = false;
    }
  }

  /**
   * One clock tick of `dt` ms that ends at session time `to`, then the cues and go live it made due.
   * `draw` false: no frame is captured after it, so the player need not repaint its cursor canvas.
   */
  #advance(dt: number, to: number, draw = true): void {
    // Update elapsed first: state listeners fired during advance() read it.
    this.#elapsed = to;
    this.clock.advance(dt, { draw });
    this.#applyCues();
    this.#goLiveWhenDone();
  }

  status(): SessionStatus {
    const { built, total } = this.player.progress;
    // Tolerate float error from summing 1000 / fps steps.
    const done = this.#builtAt !== null && this.#elapsed - this.#builtAt >= this.tailMs - 1e-6 && !this.#goingLive();
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
      else if (cue.action === "speed") this.player.setSpeed(cue.speed as number);
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

  #readScroll(): number {
    const y = this.player.scrollY;
    return typeof y === "number" && Number.isFinite(y) ? y : Number.NaN;
  }

  /** Extends, starts or ends the stretch of scrolling with the view after a step of `ms`. */
  #trackScroll(ms: number): void {
    const y = this.#readScroll();
    const before = this.#scrollY;
    this.#scrollY = y;
    if (Number.isNaN(y) || Number.isNaN(before)) return;
    const scroll = this.#scroll;
    if (Math.abs(y - before) <= SCROLL_EPSILON) {
      if (scroll) this.#scrolls.push(scroll);
      this.#scroll = null;
    } else if (scroll) {
      scroll.to = y;
      scroll.end = this.#elapsed;
    } else {
      this.#scroll = { t: this.#elapsed - ms, end: this.#elapsed, from: before, to: y };
    }
  }

  /** Goes live once, outside the engine's frame, when the finale has settled. */
  #goLiveWhenDone(): void {
    if (this.#live && this.player.state === "done") this.#goLive();
  }

  #goLive(): void {
    if (this.#liveAt !== null) return;
    this.#liveAt = this.#elapsed;
    this.player.goLive();
  }

  /** A go live started but the stage does not show the page yet (and has not run out of time). */
  #goingLive(): boolean {
    const at = this.#liveAt;
    return at !== null && !this.#liveShown && this.#elapsed - at < GO_LIVE_LIMIT_MS - TIME_EPSILON;
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
