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

/** Options for {@link RenderSession}. */
export interface RenderSessionOptions {
  /** Player options; the session supplies its own `VirtualClock`. */
  player: Omit<PlayerOptions, "clock">;
  /** Time to keep running after the build completes (finale), ms. Default 0. */
  tailMs?: number;
  /** Player factory. Default `createPlayer` from `@swarmloom/core`. */
  createPlayer?: (options: PlayerOptions) => Player;
}

/** States that mean the build itself has completed. */
const BUILT: ReadonlySet<PlayerState> = new Set(["finale", "done", "live"]);
/** Largest single step; longer jumps would skip choreography and are almost certainly a driver bug. */
export const MAX_STEP_MS = 10_000;

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
  #elapsed = 0;
  #builtAt: number | null = null;
  #error: Error | null = null;
  #started = false;
  #disposed = false;
  readonly #unsubscribe: (() => void)[];

  constructor(options: RenderSessionOptions) {
    const tail = options.tailMs ?? 0;
    if (!Number.isFinite(tail) || tail < 0) throw new RangeError(`tailMs must be a finite number >= 0, got ${tail}`);
    this.tailMs = tail;
    const create = options.createPlayer ?? coreCreatePlayer;
    this.player = create({ ...options.player, clock: this.clock });
    this.#unsubscribe = [
      this.player.on("state", (e) => {
        if (BUILT.has(e.state)) this.#markBuilt();
      }),
      this.player.on("error", (e) => this.#fail(e.error)),
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

  get soundLog(): readonly SoundEvent[] {
    return this.player.soundLog;
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
    return this.#settle();
  }

  /**
   * Advances engine time by `ms` and resolves once the resulting frame is ready.
   *
   * @throws RangeError for a negative, non-finite or over-long step; the player's error when playback failed.
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

  #markBuilt(): void {
    this.#builtAt ??= this.#elapsed;
  }

  #fail(reason: unknown): void {
    this.#error ??= toError(reason);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("RenderSession has been disposed");
  }
}
