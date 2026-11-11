import type { LoadedSource, Player, PlayerOptions, PlayerState } from "@swarmloom/core";
import { isCancellation, StudioError } from "./errors";
import type { SourceRef } from "./route";
import type { PlayerExtras, StudioServices } from "./services";
import { impactOf, playerOptionsFrom, type SettingsImpact, type StudioSettings } from "./settings";
import { type LocalInput, type OpenedSource, resolveSource } from "./source";

/** Where an open session is, from the UI's point of view. */
export type SessionPhase =
  /** Reading or downloading the source. */
  | "opening"
  /** Running the format adapter. */
  | "loading"
  /** Player created and idle: waiting for the user to start. */
  | "ready"
  /** Intro, building, paused or finale. */
  | "playing"
  /** Build finished (done or live). */
  | "done"
  | "error";

export interface SessionOptions {
  services: StudioServices;
  /** Element the inline stage mounts into. */
  host: HTMLElement;
  ref: SourceRef;
  /** Session-local file or pasted text for `file`/`launch` refs. */
  local: LocalInput | null;
  settings: StudioSettings;
  locale: string;
  /** Resolved colour scheme for adapters (`settings.theme`, "auto" already resolved). */
  scheme: "light" | "dark";
  /** Player options that override the settings (watch mode: fewer cursors, no toolbar, muted). */
  overrides?: Partial<PlayerOptions>;
  onPhase(phase: SessionPhase, error?: unknown): void;
  onProgress?(built: number, total: number): void;
  onState?(state: PlayerState): void;
  /** The core toolbar's close button or Esc. */
  onClose?(): void;
}

const MIN_LAYOUT_WIDTH = 320;
const MAX_LAYOUT_WIDTH = 2400;
/** Seeking to the end steps on by at least this share of the time reached while layers remain. */
const END_STEP_SHARE = 0.1;
/** ...and at least this many ms (eta() can read 0 while the last layers still finish). */
const END_STEP_MIN_MS = 500;
/** Steps tried before seeking to the end gives up (a 10% step covers a plan about 10x too short). */
const END_STEP_PASSES = 24;

function layoutWidth(host: HTMLElement, preferred: number | undefined): number {
  const width = preferred ?? (host.clientWidth || host.ownerDocument.documentElement.clientWidth || 1280);
  return Math.round(Math.min(MAX_LAYOUT_WIDTH, Math.max(MIN_LAYOUT_WIDTH, width)));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One opened source and its player: resolve -> adapter load -> createPlayer, plus settings
 * changes (live player calls, a fresh player, or a fresh load) and teardown. Only one load runs at
 * a time; a newer request aborts the older one.
 */
export class Session {
  opened: OpenedSource | null = null;
  loaded: LoadedSource | null = null;
  player: (Player & PlayerExtras) | null = null;
  /**
   * Player ms from play() to the end of the build (scrubber length). An estimate (player time plus
   * eta() at the furthest point reached) until the build has ended once, then the measured end.
   */
  plannedMs = 0;
  /** Player time plannedMs was estimated at: an estimate made later in the run is better. */
  private planAt = 0;
  /** plannedMs is the measured end of the build, not an estimate. */
  private planExact = false;

  private settings: StudioSettings;
  private controller: AbortController | null = null;
  private unsubscribe: Array<() => void> = [];
  private destroyed = false;
  private phase: SessionPhase = "opening";

  constructor(private readonly o: SessionOptions) {
    this.settings = o.settings;
  }

  get currentPhase(): SessionPhase {
    return this.phase;
  }

  /** Resolves and loads the source, then creates an idle player. Never throws: failures become the "error" phase. */
  async open(): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    try {
      this.setPhase("opening");
      if (!this.opened) {
        this.opened = await resolveSource(this.o.ref, { services: this.o.services, local: this.o.local, signal });
        // Settings carried by a share link apply to this visit only; they are never persisted.
        if (this.opened.settings) this.settings = { ...this.settings, ...this.opened.settings };
      }
      if (signal.aborted) return;
      this.setPhase("loading");
      const opened = this.opened;
      const loaded = await this.o.services.load(opened.input, {
        document: this.o.host.ownerDocument,
        width: layoutWidth(this.o.host, opened.layoutWidth),
        theme: this.o.scheme,
        locale: this.o.locale,
        signal,
        network: this.settings.remoteAssets ? "https" : "none",
      });
      if (signal.aborted || this.destroyed) {
        loaded.dispose?.();
        return;
      }
      this.disposeLoaded();
      this.loaded = loaded;
      this.createPlayer();
    } catch (error) {
      if (signal.aborted || this.destroyed || isCancellation(error)) return;
      this.setPhase("error", error);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** Starts the build (intro, then building). Safe to call once the phase is "ready". */
  start(): void {
    const player = this.player;
    if (!player) return;
    this.setPhase("playing");
    player.play().then(
      () => {
        // The "done"/"live" state listener may have got there first (go live, finish).
        if (this.player === player && !this.destroyed && this.phase === "playing") this.setPhase("done");
      },
      (error: unknown) => {
        if (this.player === player && !this.destroyed)
          this.setPhase("error", new StudioError("player", { message: messageOf(error) }, { cause: error }));
      },
    );
    this.replan(player);
  }

  /**
   * Applies new settings. Live ones go straight to the player; the returned impact tells the caller
   * whether a {@link rebuild} (new player) or {@link reload} (new adapter run) is still needed.
   */
  apply(next: StudioSettings): SettingsImpact {
    const prev = this.settings;
    const impact = impactOf(prev, next);
    this.settings = next;
    const player = this.player;
    if (player) {
      if (prev.speed !== next.speed) player.setSpeed(next.speed);
      if (prev.sound !== next.sound) player.setSound(next.sound);
      if (prev.follow !== next.follow) player.setFollow(next.follow);
      // Speed and follow mode change the pace, so a seek (a replay) ends somewhere else.
      if (prev.speed !== next.speed || prev.follow !== next.follow) this.resetPlan(this.plannedMs);
    }
    return impact;
  }

  /** Colour scheme used by the next adapter run ({@link reload}). */
  setScheme(scheme: "light" | "dark"): void {
    this.o.scheme = scheme;
  }

  /** Replaces the player (same blueprint) so every setting takes effect; starts it when `play` is set. */
  rebuild(play: boolean): void {
    if (!this.loaded || this.destroyed) return;
    this.createPlayer();
    if (play && this.player) this.start();
  }

  /** Runs the adapter again (theme or network changed), then starts when `play` is set. */
  async reload(play: boolean): Promise<void> {
    this.destroyPlayer();
    await this.open();
    if (play && this.phase === "ready") this.start();
  }

  /**
   * Jumps to a fraction of the planned build when the engine supports seeking. The right end (1)
   * lands on the finished build even while the plan is still a short estimate.
   */
  seek(fraction: number): boolean {
    const player = this.player;
    if (!player?.seek || this.plannedMs <= 0) return false;
    const f = Math.max(0, Math.min(1, fraction));
    player.seek(f * this.plannedMs);
    if (f === 1) this.seekToBuildEnd(player, this.plannedMs);
    return true;
  }

  get canSeek(): boolean {
    return typeof this.player?.seek === "function";
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller?.abort();
    this.destroyPlayer();
    this.disposeLoaded();
  }

  private createPlayer(): void {
    const loaded = this.loaded;
    if (!loaded) return;
    this.destroyPlayer();
    const options: PlayerOptions = {
      blueprint: loaded.blueprint,
      mode: "inline",
      host: this.o.host,
      plugins: loaded.plugins,
      controls: true,
      intro: true,
      ...playerOptionsFrom(this.settings, this.o.locale),
      onClose: () => this.o.onClose?.(),
      ...this.o.overrides,
    };
    let player: Player & PlayerExtras;
    try {
      player = this.o.services.createPlayer(options);
    } catch (error) {
      this.setPhase("error", new StudioError("player", { message: messageOf(error) }, { cause: error }));
      return;
    }
    this.player = player;
    this.resetPlan(0);
    this.unsubscribe.push(
      player.on("progress", (e) => {
        this.replan(player);
        this.o.onProgress?.(e.built, e.total);
      }),
      player.on("state", (e) => {
        this.replan(player);
        this.o.onState?.(e.state);
        if ((e.state === "done" || e.state === "live") && this.phase === "playing") this.setPhase("done");
      }),
      // Engine "error" events are non-fatal (blueprint diagnostics, failed layer tasks, plugin or
      // sound faults): the build keeps going, so they must not replace the stage with the error card.
      // Fatal failures arrive through createPlayer() throwing or play() rejecting.
      player.on("error", (e) => console.warn("[studio] player reported", e.error)),
    );
    const { built, total } = player.progress;
    this.o.onProgress?.(built, total);
    this.setPhase("ready");
  }

  private resetPlan(plannedMs: number): void {
    this.plannedMs = plannedMs;
    this.planAt = 0;
    this.planExact = false;
  }

  /**
   * Refines plannedMs from the player's clock: the build should end eta() after the current time,
   * and entering the finale measures the end. Replays over earlier ground are ignored. A player
   * without `time` keeps the first estimate, taken when the build started.
   */
  private replan(player: Player & PlayerExtras): void {
    if (this.planExact) return;
    const now = player.time;
    if (now === undefined) {
      if (this.plannedMs === 0) this.plannedMs = Math.max(0, player.eta());
      return;
    }
    if (now < this.planAt) return;
    const state = player.state;
    if (state === "finale") {
      this.plannedMs = now;
      this.planExact = true;
    } else if (state === "intro" || state === "building") {
      this.planAt = now;
      this.plannedMs = now + Math.max(0, player.eta());
    }
  }

  /**
   * After seeking to `t`, steps forward while layers remain, so a plan that was still too short
   * reaches the end anyway. The finale state event on the way measures the end.
   */
  private seekToBuildEnd(player: Player & PlayerExtras, t: number): void {
    let at = t;
    for (let pass = 0; pass < END_STEP_PASSES && this.layersLeft(player); pass++) {
      // Still building here, so a measured end (e.g. of a run rushed by finish()) was wrong.
      this.planExact = false;
      this.replan(player);
      at = Math.max(this.plannedMs, at + Math.max(END_STEP_MIN_MS, at * END_STEP_SHARE));
      player.seek?.(at);
    }
    if (!this.planExact) this.plannedMs = Math.max(this.plannedMs, at);
  }

  private layersLeft(player: Player): boolean {
    const { built, total } = player.progress;
    return built < total && player.state !== "live" && player.state !== "destroyed";
  }

  private destroyPlayer(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    const player = this.player;
    this.player = null;
    if (!player) return;
    try {
      player.destroy();
    } catch (error) {
      console.warn("[studio] player.destroy() failed", error);
    }
  }

  private disposeLoaded(): void {
    const loaded = this.loaded;
    this.loaded = null;
    try {
      loaded?.dispose?.();
    } catch (error) {
      console.warn("[studio] dispose() failed", error);
    }
  }

  private setPhase(phase: SessionPhase, error?: unknown): void {
    if (this.destroyed) return;
    this.phase = phase;
    this.o.onPhase(phase, error);
  }
}
