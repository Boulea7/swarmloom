import type { AgentView, ResolvedTheme, SoundEngine, Stage } from "../internal";
import type {
  Clock,
  LabelMode,
  Layer,
  Player,
  PlayerEvent,
  PlayerState,
  Plugin,
  Point,
  Rect,
  SoundEvent,
  SoundName,
} from "../types";
import { type Agent, BENCHED, EXITING, IDLE, SWARM, WORKING } from "./agent";
import { Build, mergeTasks } from "./build";
import { Camera } from "./camera";
import {
  EXIT_MS,
  FINALE_SETTLE_MS,
  IDLE_RUSH_MS,
  INTRO_MIN_MS,
  INTRO_SPAN_MS,
  LIVE_TOP_MAX_MS,
  LIVE_TOP_MIN_MS,
  LIVE_TOP_PER_PX_MS,
  LOOKAHEAD_SHARE,
  MAX_ERROR_EVENTS,
  MAX_PHYSICS_STEPS,
  MAX_SOUND_LOG,
  MAX_TICK_MS,
  OPENING_FADE_MS,
  PHYSICS_STEP_MS,
  REDUCED_FADE_MS,
  REDUCED_MAX_STAGGER_MS,
  REDUCED_TOTAL_MS,
  RULER_GRACE_MS,
  SCROLL_PX_PER_AGENT,
  TOUR_LEAD_SHARE,
  TOUR_STARVED_LEAD_SHARE,
} from "./constants";
import { type RestSpot, restAfterTask, sendAway } from "./crew";
import { CrossFade, type CrossFadeTiming } from "./crossfade";
import { clamp, minJerk } from "./easing";
import { Emitter } from "./events";
import { Finale } from "./finale";
import type { HaloLevels } from "./halo";
import { IntroShuttle } from "./intro";
import { createLabeler, type Labeler } from "./labels";
import {
  baseCrew,
  checkSpeed,
  type FinaleMode,
  type FollowMode,
  isFinaleMode,
  isFollowMode,
  resolveAgentCount,
} from "./options";
import { OUTLINE_CREW, outlineMask } from "./outline";
import { buildPlan, type Plan } from "./planner";
import { Roster } from "./roster";
import { AVAILABLE, DONE, LOCKED, WAITING } from "./schedule";
import { streamRng } from "./streams";

/** Normalized playback settings (see PlayerOptions). */
export interface EngineSettings {
  agents: number | "auto";
  speed: number;
  seed: number;
  labels: LabelMode | readonly string[];
  follow: FollowMode;
  finale: FinaleMode;
  /** true: the warp opening; "outline": a few cursors draw the largest shapes first; false: none. */
  intro: boolean | "outline";
  reducedMotion: boolean;
  /** Opening before the intro, player ms (PlayerOptions.opening); 0 or unset: none. */
  opening?: number;
  /** Glide back to the top on go live (PlayerOptions.liveTop). */
  liveTop?: boolean;
}

/** Everything the engine drives; created and wired by createPlayer. */
export interface EngineDeps {
  stage: Stage;
  sound: SoundEngine;
  clock: Clock;
  /** The engine stops an owned clock on go live and destroy; a caller's clock is only started. */
  ownsClock: boolean;
  /** Built-in choreographies first, then user plugins (later ones override task keys). */
  plugins: readonly Plugin[];
  /** Task duration estimate at speed 1 (choreoHelpers.estimate). */
  estimate(layer: Layer): number;
  theme: ResolvedTheme;
  /** i18n lookup for role labels (`role.layout`, ...). */
  translate(key: string): string;
  settings: EngineSettings;
  /** Feed live sound levels to the halo; off for deterministic (virtual clock) runs. */
  liveLevels: boolean;
  /** Scroll position replay returns to, stage px. */
  initialScroll: number;
  onLive?: () => void;
}

/** Fixed physics step in seconds. */
const STEP_S = PHYSICS_STEP_MS / 1000;
/** Gap between two cursors joining the intro orbit, ms. */
const INTRO_JOIN_MS = 45;
/** Backlog (sum of estimates of available tasks in sight) that calls one more agent, task ms. */
const BACKLOG_PER_AGENT_MS = 2500;
/** Share of the pool that takes part in the finale. */
const FINALE_SHARE = 0.7;
/** Tasks an agent may chain inside one frame when short tasks end early. */
const MAX_CHAIN = 8;
/** "Finish now": remaining layers fade in within this budget. */
const RUSH_TIMING: CrossFadeTiming = { fadeMs: 180, totalMs: 1200, maxStaggerMs: 40 };
/** The camera counts as standing still while the viewport stays within this many px. */
const IDLE_STILL_PX = 1;
/** Layers out of sight when the crew ran out of work in sight: a quick batch nobody watches. */
const OUT_OF_SIGHT_TIMING: CrossFadeTiming = { fadeMs: 160, totalMs: 700, maxStaggerMs: 12 };
const REDUCED_TIMING: CrossFadeTiming = {
  fadeMs: REDUCED_FADE_MS,
  totalMs: REDUCED_TOTAL_MS,
  maxStaggerMs: REDUCED_MAX_STAGGER_MS,
};
/** Longest clock delta integrated per tick; longer ones are bogus (a stuck tab never gets here). */
const MAX_TICK_TOTAL_MS = 60_000;
/** Seek fast-forwards in frames of this length (a 60 Hz run). */
const SEEK_FRAME_MS = 1000 / 60;
/** Longest seek target accepted, ms. */
const MAX_SEEK_MS = 60 * 60 * 1000;
const DEFER_SCROLL = { defer: true } as const;
/** Stereo spread of sound events: cursor x weighs 0.7, layer centre 0.3, scaled to +-0.7. */
const PAN_SPREAD = 0.7;
const FALLBACK_VIEWPORT: Readonly<Rect> = { x: 0, y: 0, w: 1280, h: 800 };

/** A running opening (PlayerOptions.opening), in player ms. */
interface Opening {
  /** The original starts to fade at this time. */
  fadeAt: number;
  /** The fade ends and the intro starts at this time. */
  endsAt: number;
  /** The swell (the page dissolving) is in the sound log. */
  swelled: boolean;
}

/** The go-live glide back to the top (PlayerOptions.liveTop), in player ms and stage px. */
interface Glide {
  from: number;
  at: number;
  dur: number;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  settled: boolean;
}

function deferred(): Deferred {
  let settle: () => void = () => {};
  const promise = new Promise<void>((r) => {
    settle = r;
  });
  const d: Deferred = {
    promise,
    settled: false,
    resolve: () => {
      d.settled = true;
      settle();
    },
  };
  return d;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function layerError(error: unknown, layer: Layer): Error {
  return new Error(`layer "${layer.id}": ${errorMessage(error)}`, { cause: error });
}

/**
 * The SwarmLoom engine: plans the build, runs choreographies on a pool of cursors and moves the
 * swarm through intro, build and finale, all on one engine timeline derived from the clock.
 *
 * Time: "player time" (pt) is the sum of clock deltas while the player runs (pauses excluded);
 * sound timestamps, intro, finale and scrolling use it. "Task time" (tt) advances by
 * `dt * speed` while building; choreography waits are measured in it. Sound events raised by a
 * task carry the exact player time of their task time, so exports keep sub-frame sound timing.
 * Nothing here reads wall-clock time or Math.random: equal seed, options, viewport and clock
 * steps give equal frames and sound logs.
 */
export class Engine implements Player {
  readonly #deps: EngineDeps;
  readonly #stage: Stage;
  readonly #sound: SoundEngine;
  readonly #clock: Clock;
  readonly #plan: Plan;
  readonly #tasks: ReturnType<typeof mergeTasks>;
  readonly #labeler: Labeler;
  readonly #emitter = new Emitter();
  readonly #camera = new Camera();
  readonly #intro = new IntroShuttle();
  readonly #finale = new Finale();
  readonly #pending = new Set<Promise<void>>();
  readonly #unsubscribe: (() => void)[] = [];
  readonly #cleanups: (() => void)[] = [];
  readonly #project: ((p: Point) => Point) | null;
  readonly #framePlugins: readonly Plugin[];
  readonly #restSpot: RestSpot | null;
  readonly #failedPlugins = new Set<Plugin>();
  readonly #levels: HaloLevels = { low: 0, mid: 0, high: 0 };
  readonly #vp: Rect = { ...FALLBACK_VIEWPORT };
  /** Pool size, the part of it that never retires while building, and the finale crew. */
  readonly #count: number;
  readonly #base: number;
  readonly #finaleSize: number;

  #build: Build;
  #roster: Roster;
  #state: PlayerState = "idle";
  #resumeState: PlayerState = "building";
  #speed: number;
  #follow: FollowMode;
  #finaleMode: FinaleMode;
  #soundLog: SoundEvent[] = [];
  #done: Deferred = deferred();
  #fade: CrossFade | null = null;
  #opening: Opening | null = null;
  #glide: Glide | null = null;
  /** Outline opening under way: the tasks its few cursors may take (see outline.ts); null otherwise. */
  #outline: Uint8Array | null = null;

  /* Timelines (see class doc). */
  #pt = 0;
  #tt = 0;
  #sim = 0;
  #physAcc = 0;
  /** Player and task time at the start of the current building frame, and its speed. */
  #framePt = 0;
  #frameTt = 0;
  #frameSpeed = 1;

  #userScrolled = false;
  #idleFor = 0;
  /** Viewport top when the crew's idle wait (re)started: a camera that moves restarts it. */
  #idleY = 0;
  #finaleAt = 0;
  #liveAt = 0;
  #dissolving = false;
  #lastGuideAt = Number.NEGATIVE_INFINITY;
  #rulers = false;
  #lastBuilt = -1;
  #errors = 0;
  #diagnosticsShown = false;
  #seeking = false;
  /** finish() rushed this run, so its later frames no longer match a replay. */
  #rushed = false;
  #soundFailed = false;
  /** Set during a frame once a pick found no available task in sight. */
  #nothingInSight = false;

  constructor(deps: EngineDeps) {
    this.#deps = deps;
    this.#stage = deps.stage;
    this.#sound = deps.sound;
    this.#clock = deps.clock;
    const { settings } = deps;
    this.#speed = checkSpeed(settings.speed);
    this.#follow = settings.follow;
    this.#finaleMode = settings.finale;
    this.#plan = buildPlan(deps.stage.blueprint, { estimate: deps.estimate });
    this.#tasks = mergeTasks(deps.plugins);
    this.#project = [...deps.plugins].reverse().find((p) => typeof p.project === "function")?.project ?? null;
    this.#framePlugins = deps.plugins.filter((p) => typeof p.frame === "function");
    this.#restSpot = this.#pluginRestSpot(deps.plugins);
    this.#labeler = createLabeler(settings.labels, deps.translate);
    const vp = this.#readViewport();
    this.#count = resolveAgentCount(settings.agents, this.#plan.taskCount, vp.w * vp.h);
    this.#base = baseCrew(this.#count);
    this.#finaleSize = clamp(Math.round(this.#count * FINALE_SHARE), this.#base, this.#count);
    this.#build = this.#newBuild();
    this.#roster = this.#newRoster();
    this.#unsubscribe.push(
      this.#clock.onTick((dt) => this.#onTick(dt)),
      this.#stage.onUserScroll((y) => {
        this.#userScrolled = true;
        this.#camera.userScrolled(y, this.#pt);
      }),
    );
  }

  /* ------------------------------------------------------------------ Player API */

  get state(): PlayerState {
    return this.#state;
  }

  get progress(): { built: number; total: number } {
    return { built: this.#build.schedule.built, total: this.#build.schedule.total };
  }

  get soundLog(): readonly SoundEvent[] {
    return this.#soundLog;
  }

  /** Player time since play(), ms: the timeline seek() moves on. */
  get time(): number {
    return this.#pt;
  }

  /** Top edge of the view, stage px. */
  get scrollY(): number {
    return this.#readViewport().y;
  }

  /** Pool size (explicit or auto). */
  get agentCount(): number {
    return this.#count;
  }

  /** Planning notes (skipped layers, broken cycles); also emitted as "error" events on the first play. */
  get diagnostics(): readonly string[] {
    return this.#plan.diagnostics;
  }

  play(): Promise<void> {
    if (this.#state === "destroyed") return Promise.resolve();
    if (this.#state === "idle") this.#begin();
    return this.#done.promise;
  }

  pause(): void {
    const s = this.#state;
    if (s !== "intro" && s !== "building" && s !== "finale" && s !== "done") return;
    this.#resumeState = s;
    this.#setState("paused");
  }

  resume(): void {
    if (this.#state === "paused") this.#setState(this.#resumeState);
  }

  /** @throws RangeError when speed is not a finite number > 0. */
  setSpeed(speed: number): void {
    const next = checkSpeed(speed);
    if (next === this.#speed) return;
    this.#speed = next;
    this.#emitSettings();
  }

  setSound(enabled: boolean): void {
    const was = this.#sound.enabled;
    this.#sound.setEnabled(Boolean(enabled));
    if (this.#sound.enabled !== was) this.#emitSettings();
  }

  /** @throws RangeError for an unknown mode. */
  setFollow(mode: FollowMode): void {
    if (!isFollowMode(mode)) throw new RangeError(`follow must be "scroll", "tour" or "none", got ${String(mode)}`);
    const changed = mode !== this.#follow;
    this.#follow = mode;
    if (mode === "none") this.#build.schedule.setBoundary(Number.POSITIVE_INFINITY);
    if (changed) this.#emitSettings();
  }

  /**
   * Chooses the end-of-build behaviour; switches immediately while the finale runs.
   * @throws RangeError for an unknown mode.
   */
  setFinale(mode: FinaleMode): void {
    if (!isFinaleMode(mode)) throw new RangeError(`finale must be "flock", "halo" or "none", got ${String(mode)}`);
    this.#finaleMode = mode;
    if (this.#inFinale() && !this.#deps.settings.reducedMotion) this.#startFinale();
  }

  replay(): void {
    if (this.#state === "destroyed") return;
    this.#abortAll();
    this.#intro.end();
    this.#finale.end(this.#roster);
    this.#guard(() => this.#stage.reset());
    this.#guard(() => this.#stage.scrollTo(this.#deps.initialScroll));
    this.#resetRun();
    this.#state = "idle";
    this.#begin();
  }

  /**
   * Moves to player time `t` (ms since play) in 60 Hz frames without drawing or playing sound;
   * sound events are still logged. A later time fast-forwards the current run, so dragging a
   * scrubber forward costs only the distance moved; an earlier time, an idle or live player and a
   * run rushed by finish() replay from the start.
   * @throws RangeError for a negative or non-finite `t`.
   */
  seek(t: number): void {
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`seek() needs a finite t >= 0, got ${t}`);
    if (this.#state === "destroyed") return;
    const target = Math.min(t, MAX_SEEK_MS);
    const paused = this.#state === "paused";
    const forward = this.#canFastForward(target);
    this.#seeking = true;
    try {
      if (!forward) this.replay();
      else if (paused) this.resume();
      // No read phase per seek frame: nothing renders between them, so the layout is never clean
      // and each read would force one. Stage.caretAt() reads on a miss, every pending text at once.
      while (this.#pt + 1e-6 < target && !this.#ended()) {
        this.#frame(Math.min(SEEK_FRAME_MS, target - this.#pt), false);
        // Undrawn, but the stage still ages task touches and virtualizes as in a drawn frame.
        this.#guard(() => this.#stage.skipFrame?.());
      }
    } finally {
      this.#seeking = false;
    }
    if (paused) this.pause();
    this.#render();
  }

  /** Whether seek(target) may continue the current run instead of replaying it. */
  #canFastForward(target: number): boolean {
    const s = this.#state === "paused" ? this.#resumeState : this.#state;
    const running = s === "intro" || s === "building" || s === "finale" || s === "done";
    return running && !this.#rushed && target >= this.#pt;
  }

  /** True once the player went live or was destroyed (read through a call to defeat narrowing). */
  #ended(): boolean {
    return this.#state === "live" || this.#state === "destroyed";
  }

  /** Completes the build quickly: running tasks stop and the remaining layers fade in. */
  finish(): void {
    let s = this.#state === "paused" ? this.#resumeState : this.#state;
    if ((s !== "intro" && s !== "building") || this.#fade) return;
    if (this.#opening) {
      // Skips the rest of the opening; reduced motion then already fades everything in, but early,
      // so the run is rushed all the same and a later seek() must replay it.
      this.#endOpening();
      if (this.#fade) {
        this.#rushed = true;
        return;
      }
      s = this.#state;
    }
    if (s === "intro") this.#fanOut();
    else if (this.#state === "paused") this.#setState("building");
    for (const a of this.#roster.agents) {
      if (!a.run) continue;
      this.#build.abort(a);
      restAfterTask(a, this.#sim);
    }
    this.#outline = null;
    this.#fade = this.#fadeRest(RUSH_TIMING);
    this.#rushed = true;
  }

  /** A cursor-free pass over every unfinished layer in plan order, starting now. */
  #fadeRest(timing: CrossFadeTiming): CrossFade {
    const { status } = this.#build.schedule;
    const queue = this.#plan.order.filter((i) => status[i] !== DONE);
    return new CrossFade(queue, this.#plan.layers, this.#tt, timing);
  }

  goLive(): void {
    const s = this.#state;
    if (s === "live" || s === "destroyed") return;
    this.#abortAll();
    this.#fade = null;
    this.#outline = null;
    if (this.#opening) {
      // The original already shows the finished content: it stays.
      this.#opening = null;
      this.#guard(() => this.#stage.original?.(null));
    }
    this.#build.schedule.finishAll();
    this.#guard(() => this.#stage.finishAll());
    this.#intro.end();
    // The halo fades out while the cursors leave, instead of vanishing in one frame.
    const fade = s !== "idle" && !this.#deps.settings.reducedMotion ? { pt: this.#pt, ms: EXIT_MS } : undefined;
    this.#finale.end(this.#roster, fade);
    this.#setRulers(false);
    const vp = this.#readViewport();
    for (const a of this.#roster.agents) if (a.mode !== BENCHED) sendAway(a, vp, EXITING);
    if (s !== "idle") this.#engineSound("sweep", 0);
    this.#emitProgress();
    this.#liveAt = this.#pt;
    this.#dissolving = false;
    const instant = s === "idle" || this.#deps.settings.reducedMotion;
    if (this.#deps.settings.liveTop) this.#glideToTop(vp.y, instant);
    this.#setState("live");
    this.#done.resolve();
    if (instant) this.#dissolve();
  }

  /**
   * Going live with `liveTop`: back to the top, instantly or in a glide the live frames drive
   * (the stage dissolves once it ends, so a live page swapped in then lines up with the top).
   */
  #glideToTop(from: number, instant: boolean): void {
    this.#glide = null;
    if (from <= 0) return;
    if (instant) {
      this.#guard(() => this.#stage.scrollTo(0));
      return;
    }
    const dur = Math.min(LIVE_TOP_MAX_MS, LIVE_TOP_MIN_MS + from * LIVE_TOP_PER_PX_MS);
    this.#glide = { from, at: this.#pt, dur };
  }

  destroy(): void {
    if (this.#state === "destroyed") return;
    this.#abortAll();
    this.#intro.end();
    this.#finale.end(this.#roster);
    for (const off of this.#unsubscribe.splice(0)) this.#guard(off);
    this.#setState("destroyed");
    this.#done.resolve();
    for (const fn of this.#cleanups.splice(0).reverse()) this.#guard(fn);
    this.#guard(() => this.#stage.destroy());
    this.#guard(() => this.#sound.destroy());
    if (this.#deps.ownsClock) this.#guard(() => this.#clock.stop());
    this.#emitter.clear();
    this.#pending.clear();
  }

  on<T extends PlayerEvent["type"]>(type: T, fn: (e: Extract<PlayerEvent, { type: T }>) => void): () => void {
    if (this.#state === "destroyed") return () => {};
    return this.#emitter.on(type, fn);
  }

  eta(): number {
    const s = this.#state === "paused" ? this.#resumeState : this.#state;
    if (s !== "idle" && s !== "intro" && s !== "building") return 0;
    return this.#openingLeft(s) + this.#buildEta(s);
  }

  /** Player ms of the opening still to come. */
  #openingLeft(s: PlayerState): number {
    if (this.#opening) return Math.max(0, this.#opening.endsAt - this.#pt);
    const opening = this.#deps.settings.opening ?? 0;
    return s === "idle" && opening > 0 ? opening + this.#openingFadeMs() : 0;
  }

  /** eta() from the end of the opening on. */
  #buildEta(s: PlayerState): number {
    const speed = this.#speed;
    if (this.#fade) return Math.max(0, this.#fade.endsAt - this.#tt) / speed;
    const schedule = this.#build.schedule;
    const left = schedule.total - schedule.built;
    if (left === 0) return 0;
    if (this.#deps.settings.reducedMotion) {
      const fade = Math.max(0, left - 1) * REDUCED_MAX_STAGGER_MS + REDUCED_FADE_MS;
      return Math.min(REDUCED_TOTAL_MS, fade) / speed;
    }
    // Cursors build only what is in sight; without a tour the rest fades in after a short wait.
    let remaining = schedule.remainingEstimate;
    let tail = 0;
    if (this.#follow !== "tour") {
      const seen = schedule.remainingInSight(this.#vp);
      remaining = seen.estimate;
      if (seen.outside) tail = IDLE_RUSH_MS + OUT_OF_SIGHT_TIMING.totalMs;
    }
    // Running tasks count with the part of their estimate not yet spent.
    for (const a of this.#roster.agents) {
      const run = a.run;
      if (run) remaining -= Math.min(this.#plan.estimate[run.task] as number, Math.max(0, this.#tt - run.startedAt));
    }
    const crew = Math.max(1, Math.min(left, Math.max(this.#roster.activeCount(), this.#base)));
    const { settings } = this.#deps;
    const intro =
      s === "intro" && !this.#opening
        ? Math.max(0, this.#intro.endsAt - this.#pt)
        : s !== "building" && settings.intro === true && !settings.reducedMotion
          ? INTRO_MIN_MS + INTRO_SPAN_MS / 2
          : 0;
    return intro + Math.max(0, remaining) / (speed * crew) + tail / speed;
  }

  ready(): Promise<void> {
    if (this.#state === "destroyed") return Promise.resolve();
    const stageReady = Promise.resolve()
      .then(() => this.#stage.ready())
      .catch((error: unknown) => this.#report(error));
    return Promise.all([stageReady, ...this.#pending]).then(() => undefined);
  }

  /* ------------------------------------------------------------------ extras for createPlayer */

  /** Current playback settings (the toolbar mirrors them). */
  settings(): { speed: number; sound: boolean; follow: FollowMode } {
    return { speed: this.#speed, sound: this.#sound.enabled, follow: this.#follow };
  }

  /**
   * Playback position for the toolbar's seek bar, in player ms: time since play() and the
   * expected build length (elapsed plus eta). Once the build is complete both are the time it
   * completed; before play (and after destroy) both are 0.
   */
  timeline(): { elapsed: number; duration: number } {
    const s = this.#state === "paused" ? this.#resumeState : this.#state;
    if (s === "idle" || s === "destroyed") return { elapsed: 0, duration: 0 };
    if (s === "intro" || s === "building") return { elapsed: this.#pt, duration: this.#pt + this.eta() };
    const end = this.#finaleAt > 0 ? this.#finaleAt : this.#pt;
    return { elapsed: end, duration: end };
  }

  /** Client-space centroid of the working cursors, or null when nobody works. */
  focus(): Point | null {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const a of this.#roster.agents) {
      if (a.mode !== WORKING) continue;
      x += a.x;
      y += a.y;
      n++;
    }
    if (n === 0) return null;
    try {
      return this.#stage.toClient({ x: x / n, y: y / n });
    } catch {
      return null;
    }
  }

  /** Runs `fn` on destroy, after the engine stopped and before the stage is destroyed. */
  addCleanup(fn: () => void): void {
    this.#cleanups.push(fn);
  }

  /** Reports an error through the "error" event (capped per run). */
  report(error: unknown): void {
    this.#report(error);
  }

  /* ------------------------------------------------------------------ lifecycle */

  #newBuild(): Build {
    return new Build(this.#plan, this.#tasks, {
      stage: this.#stage,
      seed: this.#deps.settings.seed,
      fail: (error, layer) => this.#report(layerError(error, layer)),
      track: (promise) => this.#track(promise),
      prefetch: (id) => this.#stage.prefetch?.(id),
    });
  }

  #newRoster(): Roster {
    return new Roster({
      count: this.#count,
      base: this.#base,
      seed: this.#deps.settings.seed,
      palette: this.#deps.theme.palette,
      labeler: this.#labeler,
      host: { emitSound: (agent, name, opts) => this.#agentSound(agent, name, opts) },
      restSpot: this.#restSpot,
    });
  }

  /** The last plugin's `restSpot`, guarded: one that throws is reported once and then no longer asked. */
  #pluginRestSpot(plugins: readonly Plugin[]): RestSpot | null {
    const plugin = [...plugins].reverse().find((p) => typeof p.restSpot === "function");
    if (!plugin) return null;
    let failed = false;
    return (vp, rng) => {
      if (failed) return null;
      try {
        return plugin.restSpot?.(vp, rng) ?? null;
      } catch (error) {
        failed = true;
        this.#report(new Error(`plugin "${plugin.name}" restSpot(): ${errorMessage(error)}`, { cause: error }));
        return null;
      }
    };
  }

  /** Fresh run state for replay: schedule, agents with their seeded streams, timelines. */
  #resetRun(): void {
    this.#build = this.#newBuild();
    this.#roster = this.#newRoster();
    this.#camera.reset();
    this.#soundLog = [];
    this.#fade = null;
    this.#opening = null;
    this.#glide = null;
    this.#outline = null;
    this.#rushed = false;
    this.#pt = 0;
    this.#tt = 0;
    this.#sim = 0;
    this.#physAcc = 0;
    this.#idleFor = 0;
    this.#idleY = 0;
    this.#finaleAt = 0;
    this.#liveAt = 0;
    this.#dissolving = false;
    this.#lastGuideAt = Number.NEGATIVE_INFINITY;
    this.#lastBuilt = -1;
    this.#errors = 0;
    // Read by the first building frame's tour lead, so it must not carry over from the last run.
    this.#nothingInSight = false;
    this.#userScrolled = false;
    this.#setRulers(false);
    if (this.#done.settled) this.#done = deferred();
  }

  #begin(): void {
    if (!this.#diagnosticsShown) {
      this.#diagnosticsShown = true;
      for (const note of this.#plan.diagnostics) this.#report(new Error(`blueprint: ${note}`));
    }
    if (!this.#clock.running) this.#guard(() => this.#clock.start());
    const opening = this.#deps.settings.opening ?? 0;
    if (opening > 0) {
      // The original shows (state "intro") until the opening ends; #start() then runs at its end.
      this.#opening = { fadeAt: opening, endsAt: opening + this.#openingFadeMs(), swelled: false };
      this.#guard(() => this.#stage.original?.(1));
      // Plugin scenes (WebGL) draw in their frame hook: the first frame shows them finished too.
      this.#framePluginsTick(0);
      this.#setState("intro");
      this.#emitProgress();
      return;
    }
    this.#engineSound("swell", 0);
    this.#start(0);
  }

  /** The intro (or the build) starts at player time `at`, on the blank canvas. */
  #start(at: number): void {
    Promise.resolve()
      .then(() => this.#stage.enter())
      .catch((error: unknown) => this.#report(error));
    const vp = this.#readViewport();
    if (this.#follow === "none") this.#build.schedule.setBoundary(Number.POSITIVE_INFINITY);
    else this.#unlockTo(vp);
    const { settings } = this.#deps;
    if (settings.reducedMotion) {
      this.#fade = new CrossFade(this.#plan.order, this.#plan.layers, this.#tt, REDUCED_TIMING);
      this.#setState("building");
    } else if (settings.intro === "outline") {
      this.#outline = outlineMask(this.#plan, vp, this.#outlineCrew());
      this.#setState("building");
    } else if (settings.intro) {
      this.#intro.begin(this.#stage, this.#stage.blueprint.icon, vp, at, streamRng(settings.seed, "intro"));
      this.#setState("intro");
    } else {
      this.#setState("building");
    }
    this.#emitProgress();
  }

  #openingFadeMs(): number {
    return this.#deps.settings.reducedMotion ? REDUCED_FADE_MS : OPENING_FADE_MS;
  }

  /**
   * One frame of the opening: the original holds, then fades into the blank canvas (the "swell"
   * sounds as it starts, at its exact time); at its end the stage is blank and the intro starts.
   */
  #stepOpening(opening: Opening): void {
    const pt = this.#pt;
    if (pt < opening.fadeAt) return;
    const dur = opening.endsAt - opening.fadeAt;
    this.#swell(opening, opening.fadeAt);
    const k = dur > 0 ? clamp((pt - opening.fadeAt) / dur, 0, 1) : 1;
    if (k >= 1) {
      this.#endOpening();
      return;
    }
    this.#guard(() => this.#stage.original?.(1 - minJerk(k)));
  }

  /** Logs the opening's swell once, at player time `t`. */
  #swell(opening: Opening, t: number): void {
    if (opening.swelled) return;
    opening.swelled = true;
    this.#emitSound(t, "swell", 0, undefined, undefined);
  }

  /** Ends the opening now (or at its end): a blank stage, and the intro or build starts. */
  #endOpening(): void {
    const opening = this.#opening;
    if (!opening) return;
    this.#swell(opening, Math.min(opening.fadeAt, this.#pt));
    this.#opening = null;
    this.#guard(() => this.#stage.reset());
    this.#start(Math.min(opening.endsAt, this.#pt));
  }

  #fanOut(): void {
    this.#intro.fanOut(this.#pt);
    this.#engineSound("fanout", 0);
    for (const a of this.#roster.agents) {
      if (a.mode !== SWARM) continue;
      a.mode = IDLE;
      a.showHeading = false;
      a.idleSince = this.#sim;
      a.holdUntil = 0;
    }
    this.#setState("building");
  }

  #enterFinale(): void {
    this.#engineSound("chord", 0);
    this.#setRulers(false);
    this.#fade = null;
    this.#finaleAt = this.#pt;
    this.#setState("finale");
    this.#done.resolve();
    if (!this.#deps.settings.reducedMotion) this.#startFinale();
  }

  #startFinale(): void {
    const mode = this.#finaleMode;
    this.#finale.begin(
      mode,
      this.#roster,
      this.#stage,
      this.#deps.theme.palette,
      mode === "none" ? 0 : this.#finaleSize,
      this.#pt,
    );
  }

  #dissolve(): void {
    if (this.#dissolving) return;
    this.#dissolving = true;
    Promise.resolve()
      .then(() => this.#stage.goLive())
      .then(
        () => {
          if (this.#state !== "live") return;
          this.#roster.benchAll();
          if (this.#deps.ownsClock) this.#guard(() => this.#clock.stop());
          this.#guard(() => this.#deps.onLive?.());
        },
        (error: unknown) => this.#report(error),
      );
  }

  #abortAll(): void {
    for (const a of this.#roster.agents) if (a.run) this.#build.abort(a);
  }

  #inFinale(): boolean {
    const s = this.#state === "paused" ? this.#resumeState : this.#state;
    return s === "finale" || s === "done";
  }

  /* ------------------------------------------------------------------ frame loop */

  /**
   * Clock tick: the stage's read phase, then the frame. Long deltas (coarse export frames) are
   * integrated in slices of at most MAX_TICK_MS so player time always equals the clock time
   * delivered, then drawn once. Slicing stops early only when this tick ends the run (goes live
   * or destroys the player); a player already live keeps the whole delta, since live plugins and
   * the cursor exit follow player time.
   */
  #onTick(dt: number): void {
    const s = this.#state;
    if (s === "idle" || s === "destroyed") return;
    // Read phase first: the layout is clean until this tick's tasks write to the DOM.
    this.#measure();
    const wasLive = s === "live";
    let left = Number.isFinite(dt) ? clamp(dt, 0, MAX_TICK_TOTAL_MS) : 0;
    do {
      const slice = Math.min(left, MAX_TICK_MS);
      left -= slice;
      this.#frame(slice, left <= 0);
    } while (left > 0 && !this.#endedDuringTick(wasLive));
  }

  /** The stage's read phase (caret blocks of typed text), taken before a frame's DOM writes. */
  #measure(): void {
    try {
      this.#stage.measure?.();
    } catch (error) {
      this.#report(error);
    }
  }

  /** True once the player was destroyed, or went live during a tick that started before live. */
  #endedDuringTick(wasLive: boolean): boolean {
    return this.#state === "destroyed" || (!wasLive && this.#state === "live");
  }

  /** Advances every timeline by `dt` player ms; draws when `draw` (and not seeking). */
  #frame(dt: number, draw: boolean): void {
    const vp = this.#readViewport();
    if (this.#state !== "paused") {
      this.#pt += dt;
      // The intro icon keeps fading out after fan-out, through building and finale.
      this.#intro.frame(vp, this.#pt);
      switch (this.#state) {
        case "intro":
          if (this.#opening) this.#stepOpening(this.#opening);
          else this.#stepIntro(dt, vp);
          break;
        case "building":
          // The intro icon shrinks away after the fan-out, which already switched to building.
          this.#intro.frame(vp, this.#pt);
          this.#stepBuilding(dt, vp);
          break;
        case "finale":
        case "done":
          this.#intro.frame(vp, this.#pt);
          this.#stepFinale(dt, vp);
          break;
        case "live":
          this.#stepLive(dt, vp);
          break;
        default:
          break;
      }
      this.#framePluginsTick(dt);
    }
    this.#userScrolled = false;
    if (draw && !this.#seeking) this.#render();
  }

  #stepIntro(dt: number, vp: Rect): void {
    this.#camera.track(vp, dt, this.#userScrolled);
    const roster = this.#roster;
    if (roster.activeCount() < this.#base) roster.join(SWARM, vp, this.#sim, INTRO_JOIN_MS);
    const steps = this.#takeSteps(dt);
    for (let k = 0; k < steps; k++) {
      this.#sim += PHYSICS_STEP_MS;
      for (const a of roster.agents) if (a.mode === SWARM) this.#intro.steer(a, vp, this.#sim, STEP_S);
      roster.stepFree(vp, this.#sim, STEP_S);
    }
    if (this.#pt >= this.#intro.endsAt || this.#userScrolled) this.#fanOut();
  }

  #stepBuilding(dt: number, vp0: Rect): void {
    const speed = this.#speed;
    const dtt = dt * speed;
    this.#framePt = this.#pt - dt;
    this.#frameTt = this.#tt;
    this.#frameSpeed = speed;
    this.#tt += dtt;
    const tt = this.#tt;
    const schedule = this.#build.schedule;

    this.#camera.track(vp0, dt, this.#userScrolled);
    let vp = vp0;
    if (this.#follow === "tour" && !this.#fade) {
      // While idle cursors found nothing in sight last frame, the tour brings new work into view.
      const lead = this.#nothingInSight ? TOUR_STARVED_LEAD_SHARE : TOUR_LEAD_SHARE;
      const y = this.#camera.tour(vp, schedule.frontier(vp.y), this.#stage.blueprint.size.h, speed, dt, this.#pt, lead);
      if (Number.isFinite(y)) {
        // A seek writes the scroller once, when it draws: each write here would land after the
        // last frame's task writes and force a layout.
        this.#guard(() => this.#stage.scrollTo(y, this.#seeking ? DEFER_SCROLL : undefined));
        vp = this.#readViewport();
      }
    }
    if (this.#follow !== "none") this.#unlockTo(vp);

    if (this.#fade) {
      this.#fade.step(tt, this.#stage, schedule, (error, layer) => this.#report(layerError(error, layer)));
    } else if (this.#outline) {
      this.#runAgents(tt, vp);
      this.#roster.balance(this.#outlineCrew(), vp, this.#sim);
      if (this.#outlineTaken(vp)) this.#callSwarm();
    } else {
      this.#runAgents(tt, vp);
      this.#fadeOutOfSight(dtt, vp);
      const boost = this.#follow === "scroll" ? Math.ceil(this.#camera.scrollSpeed / SCROLL_PX_PER_AGENT) : 0;
      // Only work in sight calls cursors: they may not pick anything else.
      const room = Math.max(0, this.#count - this.#base - boost);
      const backlog = Math.ceil(schedule.availableInSight(vp, room * BACKLOG_PER_AGENT_MS) / BACKLOG_PER_AGENT_MS);
      this.#roster.balance(clamp(this.#base + boost + backlog, this.#base, this.#count), vp, this.#sim);
    }

    const steps = this.#takeSteps(dtt);
    for (let k = 0; k < steps; k++) {
      this.#sim += PHYSICS_STEP_MS;
      this.#roster.stepFree(vp, this.#sim, STEP_S);
    }

    if (this.#build.guidesActive) this.#lastGuideAt = this.#pt;
    this.#setRulers(this.#pt - this.#lastGuideAt < RULER_GRACE_MS);
    this.#emitProgress();
    if (schedule.done && this.#roster.workingCount() === 0) this.#enterFinale();
  }

  /**
   * Drives working agents and gives idle ones the best available task in sight, in agent order.
   * Once a pick finds nothing in sight, nobody else looks again this frame (the answer does not
   * depend on the agent).
   */
  #runAgents(tt: number, vp: Rect): void {
    this.#nothingInSight = false;
    for (const a of this.#roster.agents) {
      if (a.mode === WORKING) this.#drive(a, tt, vp);
      else if (a.mode === IDLE) {
        const i = this.#pick(a, vp);
        if (i < 0) continue;
        this.#build.start(a, i, tt);
        this.#drive(a, tt, vp);
      }
    }
  }

  #pick(a: Agent, vp: Rect): number {
    const schedule = this.#build.schedule;
    if (this.#nothingInSight || schedule.available === 0) return -1;
    const i = schedule.pick(a.x, a.y, vp, this.#outline);
    if (i < 0) this.#nothingInSight = true;
    return i;
  }

  /** Cursors of the outline opening: {@link OUTLINE_CREW}, or the whole pool when it is smaller. */
  #outlineCrew(): number {
    return Math.min(OUTLINE_CREW, this.#count);
  }

  /**
   * True once every outline task has been taken (or completed), or when the outline cursors can
   * take none of the rest: nobody works and none of it is available in sight.
   */
  #outlineTaken(vp: Rect): boolean {
    const mask = this.#outline;
    if (!mask) return true;
    const { status } = this.#build.schedule;
    let open = false;
    for (let i = 0; i < this.#plan.taskCount && !open; i++) {
      const s = status[i];
      open = mask[i] === 1 && (s === WAITING || s === LOCKED || s === AVAILABLE);
    }
    if (!open) return true;
    return this.#roster.workingCount() === 0 && !this.#build.schedule.hasWorkInSight(vp, mask);
  }

  /** Ends the outline opening: the rest of the swarm walks in to fill in the details. */
  #callSwarm(): void {
    this.#outline = null;
    this.#nothingInSight = false;
    this.#engineSound("fanout", 0);
  }

  /**
   * Advances an agent's task; when it ends before `tt`, the agent takes its next task at the
   * exact end time, so short tasks do not wait for frame boundaries.
   */
  #drive(a: Agent, tt: number, vp: Rect): void {
    const build = this.#build;
    for (let chained = 0; a.mode === WORKING; chained++) {
      if (!build.step(a, tt)) return;
      // The finished task may have released work in sight.
      this.#nothingInSight = false;
      const at = Math.min(a.localTime, tt);
      if (chained < MAX_CHAIN) {
        const next = this.#pick(a, vp);
        if (next >= 0) {
          build.start(a, next, at);
          continue;
        }
      }
      restAfterTask(a, this.#sim);
    }
  }

  /**
   * The crew only builds what is in sight. When it has had nothing to do for IDLE_RUSH_MS while
   * the camera stood still (judged by where the viewport is, so a tour or scroll the stage clamps
   * does not count as moving), everything left (layers out of sight and whatever they block)
   * fades in without cursors, so an unscrolled page still completes and the swarm never works
   * out of sight. A scroll that brings work into view restarts the wait.
   */
  #fadeOutOfSight(dtt: number, vp: Rect): void {
    const schedule = this.#build.schedule;
    const moved = this.#userScrolled || Math.abs(vp.y - this.#idleY) > IDLE_STILL_PX;
    if (schedule.done || moved || this.#roster.workingCount() > 0) {
      this.#idleFor = 0;
      this.#idleY = vp.y;
      return;
    }
    this.#idleFor += dtt;
    if (this.#idleFor < IDLE_RUSH_MS) return;
    this.#idleFor = 0;
    // Agents still walking in may be about to take work in sight: wait for them.
    if (schedule.hasWorkInSight(vp)) return;
    this.#fade = this.#fadeRest(OUT_OF_SIGHT_TIMING);
  }

  #stepFinale(dt: number, vp: Rect): void {
    const roster = this.#roster;
    if (!this.#deps.settings.reducedMotion) {
      this.#finale.frame(roster, vp, this.#pt, this.#haloLevels());
      const pointer = this.#pointer();
      const steps = this.#takeSteps(dt);
      for (let k = 0; k < steps; k++) {
        this.#sim += PHYSICS_STEP_MS;
        this.#finale.step(roster.agents, vp, pointer, this.#pt, STEP_S);
        roster.stepFree(vp, this.#sim, STEP_S);
      }
    }
    if (this.#state === "finale" && this.#pt - this.#finaleAt >= FINALE_SETTLE_MS) this.#setState("done");
  }

  #stepLive(dt: number, vp: Rect): void {
    const glide = this.#glide;
    if (glide) {
      const k = clamp((this.#pt - glide.at) / glide.dur, 0, 1);
      if (k >= 1) this.#glide = null;
      this.#guard(() => this.#stage.scrollTo(glide.from * (1 - minJerk(k))));
    }
    this.#finale.fadeFrame(vp, this.#pt, this.#haloLevels());
    const steps = this.#takeSteps(dt);
    for (let k = 0; k < steps; k++) {
      this.#sim += PHYSICS_STEP_MS;
      this.#roster.stepFree(vp, this.#sim, STEP_S);
    }
    const left = this.#finale.fading || this.#roster.agents.some((a) => a.mode === EXITING);
    if ((this.#pt - this.#liveAt >= EXIT_MS || !left) && !this.#glide) {
      this.#dissolve();
    }
  }

  /** Number of fixed physics steps covered by `ms` more simulated time. */
  #takeSteps(ms: number): number {
    this.#physAcc += ms;
    let steps = Math.floor(this.#physAcc / PHYSICS_STEP_MS);
    if (steps > MAX_PHYSICS_STEPS) {
      steps = MAX_PHYSICS_STEPS;
      this.#physAcc = 0;
    } else {
      this.#physAcc -= steps * PHYSICS_STEP_MS;
    }
    return steps;
  }

  #unlockTo(vp: Rect): void {
    this.#build.schedule.setBoundary(vp.y + vp.h * (1 + LOOKAHEAD_SHARE));
  }

  #render(): void {
    const s = this.#state;
    if (s === "idle" || s === "destroyed") return;
    const views: readonly AgentView[] = this.#roster.views(this.#project);
    try {
      this.#stage.render(this.#pt, views);
    } catch (error) {
      this.#report(error);
    }
  }

  #framePluginsTick(dt: number): void {
    for (const plugin of this.#framePlugins) {
      if (this.#failedPlugins.has(plugin)) continue;
      try {
        plugin.frame?.(this.#pt, dt);
      } catch (error) {
        this.#failedPlugins.add(plugin);
        this.#report(new Error(`plugin "${plugin.name}" frame(): ${errorMessage(error)}`, { cause: error }));
      }
    }
  }

  /* ------------------------------------------------------------------ inputs */

  /** Stage viewport copied into a reused rect; keeps the last valid one when the stage reports garbage. */
  #readViewport(): Rect {
    let vp: Rect | undefined;
    try {
      vp = this.#stage.viewport();
    } catch {
      vp = undefined;
    }
    const out = this.#vp;
    if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) && Number.isFinite(vp.w) && Number.isFinite(vp.h)) {
      if (vp.w > 0 && vp.h > 0) {
        out.x = vp.x;
        out.y = vp.y;
        out.w = vp.w;
        out.h = vp.h;
      }
    }
    return out;
  }

  #pointer(): Point | null {
    try {
      const p = this.#stage.pointer();
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    } catch {
      return null;
    }
  }

  /** Halo drive from the master bus (low / mid / high thirds of the bands), or null. */
  #haloLevels(): HaloLevels | null {
    if (!this.#deps.liveLevels || this.#finale.mode !== "halo") return null;
    let levels: ReturnType<SoundEngine["levels"]>;
    try {
      levels = this.#sound.levels();
    } catch {
      return null;
    }
    if (!levels || levels.bands.length === 0) return null;
    const bands = levels.bands;
    const third = Math.max(1, Math.floor(bands.length / 3));
    const avg = (from: number, to: number): number => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += bands[i] ?? 0;
      return to > from ? sum / (to - from) : 0;
    };
    this.#levels.low = avg(0, third);
    this.#levels.mid = avg(third, 2 * third);
    this.#levels.high = avg(2 * third, bands.length);
    return this.#levels;
  }

  /* ------------------------------------------------------------------ sound and events */

  #agentSound(agent: Agent, name: SoundName, opts?: { pitch?: number; vel?: number }): void {
    let t = this.#pt;
    if (this.#state === "building" && this.#frameSpeed > 0) {
      t = clamp(this.#framePt + (agent.localTime - this.#frameTt) / this.#frameSpeed, this.#framePt, this.#pt);
    }
    const vp = this.#vp;
    const cursor = clamp(((agent.x - vp.x) / vp.w) * 2 - 1, -1, 1);
    const box = agent.run?.layer.box;
    const layer = box ? clamp(((box.x + box.w / 2 - vp.x) / vp.w) * 2 - 1, -1, 1) : cursor;
    const pan = (0.7 * cursor + 0.3 * layer) * PAN_SPREAD;
    this.#emitSound(t, name, Number.isFinite(pan) ? pan : 0, opts?.pitch, opts?.vel);
  }

  #engineSound(name: SoundName, pan: number): void {
    this.#emitSound(this.#pt, name, pan, undefined, undefined);
  }

  #emitSound(t: number, name: SoundName, pan: number, pitch: number | undefined, vel: number | undefined): void {
    if (typeof name !== "string" || name.length === 0) return;
    const ev: SoundEvent = { t, name, pan };
    if (typeof pitch === "number" && Number.isFinite(pitch)) ev.pitch = pitch;
    if (typeof vel === "number" && Number.isFinite(vel)) ev.vel = clamp(vel, 0, 1);
    if (this.#soundLog.length < MAX_SOUND_LOG) this.#soundLog.push(ev);
    if (!this.#seeking && !this.#soundFailed) {
      try {
        this.#sound.play(ev);
      } catch (error) {
        this.#soundFailed = true;
        this.#report(new Error(`sound: ${errorMessage(error)}`, { cause: error }));
      }
    }
    if (this.#emitter.has("sound")) this.#emitter.emit({ type: "sound", event: ev });
  }

  #setState(state: PlayerState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#emitter.emit({ type: "state", state });
  }

  #emitSettings(): void {
    if (this.#emitter.has("settings")) this.#emitter.emit({ type: "settings", ...this.settings() });
  }

  #emitProgress(): void {
    const { built, total } = this.#build.schedule;
    if (built === this.#lastBuilt) return;
    this.#lastBuilt = built;
    if (this.#emitter.has("progress")) this.#emitter.emit({ type: "progress", built, total });
  }

  #setRulers(on: boolean): void {
    if (on === this.#rulers) return;
    this.#rulers = on;
    this.#guard(() => this.#stage.setRulers(on));
  }

  #track(promise: Promise<void>): void {
    const tracked = promise.finally(() => this.#pending.delete(tracked));
    this.#pending.add(tracked);
  }

  #report(error: unknown): void {
    if (this.#errors >= MAX_ERROR_EVENTS) return;
    this.#errors++;
    this.#emitter.emit({ type: "error", error: toError(error) });
  }

  /** Runs a stage or host call that must not break the frame loop; reports failures. */
  #guard(fn: () => unknown): void {
    try {
      fn();
    } catch (error) {
      this.#report(error);
    }
  }
}
