import {
  type Clock,
  type LoadedSource,
  type Player,
  type PlayerOptions,
  type PlayerState,
  RealtimeClock,
} from "@swarmloom/core";
import { isCancellation, StudioError } from "./errors";
import type { SourceRef } from "./route";
import type { StudioServices } from "./services";
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
  /**
   * Resolves `ref` in place of {@link resolveSource}: the watch reads a source once for its plays
   * and its phone link, since a handoff cannot be read twice.
   */
  resolve?(signal: AbortSignal): Promise<OpenedSource>;
  onPhase(phase: SessionPhase, error?: unknown): void;
  onProgress?(built: number, total: number): void;
  onState?(state: PlayerState): void;
  /**
   * The player's toolbar or its shortcuts changed speed, sound or follow mode. The patch already
   * plays and is in {@link Session.playSettings}; the caller makes it Studio's setting too.
   */
  onSettings?(patch: Partial<StudioSettings>): void;
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
/** Largest scrubber position before the build has ended, so a plan that is short never reads "finished". */
const MAX_POSITION_BEFORE_END = 0.99;
/** Player states after the build: the scrubber is full. */
const BUILD_ENDED: ReadonlySet<PlayerState> = new Set(["finale", "done", "live"]);
/** Sound settings a player keeps while muted and takes only when made: setSound() toggles just `sound`. */
const SOUND_CHOICE = ["soundPack", "volume", "beatHits"] as const;

function layoutWidth(host: HTMLElement, preferred: number | undefined): number {
  const width = preferred ?? (host.clientWidth || host.ownerDocument.documentElement.clientWidth || 1280);
  return Math.round(Math.min(MAX_LAYOUT_WIDTH, Math.max(MIN_LAYOUT_WIDTH, width)));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The preview player's clock: real time that {@link Session.hold} can stop while an in-page export
 * needs the main thread. The player still decides with start() and stop() whether it runs; a held
 * clock delivers no frames until it is let go, then goes on without a jump.
 */
class PreviewClock implements Clock {
  private readonly time = new RealtimeClock();
  private wanted = false;
  private held = false;

  get running(): boolean {
    return this.wanted;
  }

  now(): number {
    return this.time.now();
  }

  onTick(fn: (dt: number, now: number) => void): () => void {
    return this.time.onTick(fn);
  }

  start(): void {
    this.wanted = true;
    if (!this.held) this.time.start();
  }

  stop(): void {
    this.wanted = false;
    this.time.stop();
  }

  hold(on: boolean): void {
    this.held = on;
    if (on) this.time.stop();
    else if (this.wanted) this.time.start();
  }
}

/**
 * One opened source and its player: resolve -> adapter load -> createPlayer, plus settings
 * changes (live player calls, a fresh player, or a fresh load) and teardown. Only one load runs at
 * a time; a newer request aborts the older one.
 */
export class Session {
  opened: OpenedSource | null = null;
  loaded: LoadedSource | null = null;
  player: Player | null = null;
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
  /** Settings the current player was made with: its {@link SOUND_CHOICE} stays these. */
  private madeWith: StudioSettings | null = null;
  /** Sound was on at the last {@link apply} (or when the player was made). */
  private soundWasOn = false;
  /** The current player's clock: Studio's own, so {@link hold} can stop it. */
  private clock: PreviewClock | null = null;
  /** {@link hold} is on; a new player starts held too. */
  private held = false;
  /** {@link hold} paused the player, so letting go resumes it. */
  private heldPause = false;
  private controller: AbortController | null = null;
  private unsubscribe: Array<() => void> = [];
  private destroyed = false;
  private phase: SessionPhase = "opening";
  /**
   * Settings {@link apply} changed while the source was still being read: the user's, so the values
   * a share link carries for them no longer apply when it opens.
   */
  private readonly changedBeforeOpen = new Set<keyof StudioSettings>();

  constructor(private readonly o: SessionOptions) {
    this.settings = o.settings;
  }

  get currentPhase(): SessionPhase {
    return this.phase;
  }

  /**
   * Settings the preview plays with: Studio's, plus those a share link carries for this visit and
   * the toolbar's speed, sound and follow mode. An export or a new share link must use these, not
   * the saved settings, to make the same performance.
   */
  get playSettings(): StudioSettings {
    return this.settings;
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
        const { services, local } = this.o;
        const opened = await (this.o.resolve?.(signal) ?? resolveSource(this.o.ref, { services, local, signal }));
        this.opened = this.withoutChanged(opened);
        // Settings carried by a share link apply to this visit only; they are never persisted. The
        // view hands them to Studio (AppContext.sourceSettings), so later apply() calls carry them.
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

  /** `opened` without the settings the user changed while it was read (see {@link changedBeforeOpen}). */
  private withoutChanged(opened: OpenedSource): OpenedSource {
    const carried = opened.settings;
    if (!carried || !Object.keys(carried).some((key) => this.changedBeforeOpen.has(key as keyof StudioSettings))) {
      return opened;
    }
    const settings: Partial<StudioSettings> = { ...carried };
    for (const key of this.changedBeforeOpen) delete settings[key];
    return { ...opened, settings };
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
   * Applies new settings: Studio's, which include a share link's until the user changes them. Live
   * ones go straight to the player; the returned impact tells the caller whether a {@link rebuild}
   * (new player) or {@link reload} (new adapter run) is still needed. A setting changed while the
   * source is still being read keeps the user's value when a share link carries another.
   * The language setting is not one of them: the resolved locale arrives through {@link setLocale}
   * once Studio's strings for it have loaded.
   * Turning sound on is live, but when the sound pack, volume or beat hits changed since the player
   * was made (while muted, without a restart) the impact is "rebuild": the player still holds the
   * old ones. This also covers the toolbar's unmute, which reaches here after {@link adopt}.
   */
  apply(next: StudioSettings): SettingsImpact {
    const prev = this.settings;
    let impact = impactOf({ ...prev, locale: next.locale }, next);
    this.settings = next;
    if (!this.opened) {
      for (const key of Object.keys(next) as (keyof StudioSettings)[]) {
        if (prev[key] !== next[key]) this.changedBeforeOpen.add(key);
      }
    }
    const unmuted = next.sound && !this.soundWasOn;
    this.soundWasOn = next.sound;
    const player = this.player;
    if (player) {
      if (prev.speed !== next.speed) player.setSpeed(next.speed);
      if (prev.sound !== next.sound) player.setSound(next.sound);
      if (prev.follow !== next.follow) player.setFollow(next.follow);
      // Speed and follow mode change the pace, so a seek (a replay) ends somewhere else.
      if (prev.speed !== next.speed || prev.follow !== next.follow) this.resetPlan(this.plannedMs);
      const made = this.madeWith;
      const stale = made !== null && SOUND_CHOICE.some((key) => made[key] !== next[key]);
      if (unmuted && stale && (impact === "live" || impact === "none")) impact = "rebuild";
    }
    return impact;
  }

  /**
   * Takes the player's live settings after its toolbar changed them: they play from now on, so
   * playSettings, the next player and the caller ({@link SessionOptions.onSettings}) get them.
   * Changes made by {@link apply} arrive here already equal and are ignored.
   */
  private adopt(live: Pick<StudioSettings, "speed" | "sound" | "follow">): void {
    const patch: Partial<StudioSettings> = {};
    if (live.speed !== this.settings.speed) patch.speed = live.speed;
    if (live.sound !== this.settings.sound) patch.sound = live.sound;
    if (live.follow !== this.settings.follow) patch.follow = live.follow;
    if (Object.keys(patch).length === 0) return;
    this.settings = { ...this.settings, ...patch };
    if (patch.speed !== undefined || patch.follow !== undefined) this.resetPlan(this.plannedMs);
    this.o.onSettings?.(patch);
  }

  /**
   * Locale for the next player and adapter run. Returns true when it changed, so the caller can
   * {@link rebuild} for the current player to speak it too.
   */
  setLocale(locale: string): boolean {
    if (locale === this.o.locale) return false;
    this.o.locale = locale;
    return true;
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
   * Stills the preview while an in-page export runs, so it does not take the main thread from the
   * export: a building player pauses (its toolbar and the scrubber show it), and the clock stops
   * in every state, so nothing moves or redraws. `false` plays on and resumes what the hold paused.
   */
  hold(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    const player = this.player;
    if (on && (player?.state === "intro" || player?.state === "building")) {
      player.pause();
      this.heldPause = true;
    }
    this.clock?.hold(on);
    if (!on && this.heldPause) {
      this.heldPause = false;
      player?.resume();
    }
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

  /** True when the current player implements the optional `seek(t)` (decisions-v1 S05). */
  get canSeek(): boolean {
    return typeof this.player?.seek === "function";
  }

  /**
   * Plain-English quality notes of the adapter run: what it removed or approximated (the `notes`
   * of the Lottie, DOCX, DOC and OpenDocument results). Empty when there are none.
   */
  get notes(): string[] {
    const notes = (this.loaded as { notes?: unknown } | null)?.notes;
    if (!Array.isArray(notes)) return [];
    return notes.filter((note): note is string => typeof note === "string" && note.trim() !== "");
  }

  /**
   * Scrubber position between 0 and 1, on the same scale {@link seek} takes: player time over
   * plannedMs, 1 once the build has ended and at most 0.99 before. A player without `time` reports
   * the share of layers built instead.
   */
  get position(): number {
    const player = this.player;
    if (!player) return 0;
    if (BUILD_ENDED.has(player.state)) return 1;
    const time = player.time;
    let share: number;
    if (time !== undefined && this.plannedMs > 0) {
      share = time / this.plannedMs;
    } else {
      const { built, total } = player.progress;
      share = total > 0 ? built / total : 0;
    }
    return Number.isFinite(share) ? Math.max(0, Math.min(MAX_POSITION_BEFORE_END, share)) : 0;
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
    const clock = new PreviewClock();
    clock.hold(this.held);
    const options: PlayerOptions = {
      blueprint: loaded.blueprint,
      mode: "inline",
      host: this.o.host,
      plugins: loaded.plugins,
      controls: true,
      intro: true,
      ...playerOptionsFrom(this.settings, this.o.locale),
      clock,
      // The player stops only a clock it made itself: this one stops here once live, and in destroyPlayer().
      onLive: () => clock.stop(),
      onClose: () => this.o.onClose?.(),
      ...this.o.overrides,
    };
    let player: Player;
    try {
      player = this.o.services.createPlayer(options);
    } catch (error) {
      this.setPhase("error", new StudioError("player", { message: messageOf(error) }, { cause: error }));
      return;
    }
    this.player = player;
    this.clock = clock;
    this.madeWith = this.settings;
    this.soundWasOn = this.settings.sound;
    this.resetPlan(0);
    this.unsubscribe.push(
      player.on("progress", (e) => {
        this.replan(player);
        this.o.onProgress?.(e.built, e.total);
      }),
      player.on("settings", (e) => this.adopt(e)),
      player.on("state", (e) => {
        this.replan(player);
        this.o.onState?.(e.state);
        if ((e.state === "done" || e.state === "live") && this.phase === "playing") this.setPhase("done");
        // A seek back or the toolbar's replay starts a new run of a finished build.
        if ((e.state === "intro" || e.state === "building") && this.phase === "done") this.setPhase("playing");
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
  private replan(player: Player): void {
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
  private seekToBuildEnd(player: Player, t: number): void {
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
    const clock = this.clock;
    this.player = null;
    this.clock = null;
    this.heldPause = false;
    try {
      player?.destroy();
    } catch (error) {
      console.warn("[studio] player.destroy() failed", error);
    }
    clock?.stop();
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
