/**
 * SwarmLoom core INTERNAL seams (types only; implementations live in the owning zones) (not exported from @swarmloom/core's public index
 * except where noted). These let five teams implement packages/core in parallel:
 *
 *   engine  -> src/engine/**, src/player.ts, src/clock.ts, src/rng.ts, src/index.ts, src/types.ts
 *   choreo  -> src/choreo/**
 *   stage   -> src/stage/**, src/overlay/**, src/cursor/**, src/theme.ts
 *   ui      -> src/ui/**, src/i18n/**
 *   sound   -> src/sound/**
 *
 * Each team owns its directories exclusively. Import other zones only through
 * the module paths and signatures below. If a seam is insufficient, add an
 * OPTIONAL member and note it in your report; never change an existing member.
 */

import type {
  Blueprint,
  CursorShape,
  Layer,
  OverlayLevel,
  Player,
  Plugin,
  Point,
  Rect,
  SoundEvent,
  SoundOptions,
  StageApi,
} from "./types";

/* ================================================================== */
/* theme  (module: src/theme.ts, owner: stage)                        */
/* ================================================================== */

export interface ResolvedTheme {
  /** Cursor colours cycled across agents; original SwarmLoom palette by default (not copied from any other product). */
  palette: string[];
  /** Guides, rulers, measurements. */
  accent: string;
  /** Selection outlines and size badges. */
  select: string;
  /** Toolbar / badge chrome. */
  chrome: "light" | "dark";
  /** Scheme of the content being built (from Blueprint.scheme or background luminance). */
  scheme: "light" | "dark";
}

/** src/theme.ts */
export type ResolveThemeFn = (
  theme: "auto" | "light" | "dark" | import("./types").ThemeSpec | undefined,
  blueprint: Blueprint,
  prefersDark: boolean,
) => ResolvedTheme;

/* ================================================================== */
/* stage  (module: src/stage/index.ts, owner: stage)                  */
/* ================================================================== */

/** What the stage needs to draw one cursor this frame. Positions are STAGE coordinates. */
export interface AgentView {
  id: number;
  name: string;
  /** Text shown in the name tag (depends on LabelMode); empty hides the tag. */
  label: string;
  color: string;
  x: number;
  y: number;
  shape: CursorShape;
  pressed: boolean;
  /** Status bubble text from AgentApi.say(); empty hides it. */
  bubble: string;
  /** 0..1, used for fade in/out during intro and go-live. */
  alpha: number;
  /** Visual scale, 1 = normal; intro/finale may pulse it. */
  scale: number;
  /** Heading in radians for flocking (cursor art may tilt slightly); optional. */
  angle?: number;
  /** Hang the name tag below left of the hotspot: the cursor works on text that runs to its right. */
  tagLeft?: boolean;
}

export interface StageOptions {
  blueprint: Blueprint;
  mode: "overlay" | "inline";
  /** Overlay: usually document.body (stage is position:fixed, full viewport). Inline: the container element. */
  host: HTMLElement;
  theme: ResolvedTheme;
  /** Renderers for custom layers come from plugins[].renderers (keyed by CustomLayer.task). Also calls plugin.setup. */
  plugins: Plugin[];
  reducedMotion: boolean;
  /** Initial vertical scroll in stage px (overlay: the page's scrollY at capture time). */
  initialScroll?: number;
  /** Seeded RNG for any visual jitter; the stage must never call Math.random or Date.now. */
  rng: () => number;
  /** Editing marks drawn on the overlay canvas. Default "full". */
  overlays?: OverlayLevel;
}

/**
 * The stage renders the blueprint inside an isolated shadow root:
 *  - a blank canvas with blueprint.background covering the viewport,
 *  - an inner scroller containing the world (blueprint.size), layers mounted lazily
 *    (virtualized: mounted when within ~1.5 viewports of the visible area, unmounted when far
 *    and not in progress), each layer initially invisible (reveal 0),
 *  - one <canvas> overlay above content for cursors, tags, bubbles, rulers and transient
 *    overlays (ghost rects, badges, guides, measurements, caret, rubber band, anchors, icon, halo),
 *  - a UI layer above everything for the toolbar.
 * In overlay mode the user scrolls the stage's inner scroller (the real page stays hidden
 * underneath); goLive() syncs window scroll to the stage scroll and fades the stage out.
 */
export interface Stage extends StageApi {
  readonly root: ShadowRoot;
  /** Container for the toolbar; above the cursor canvas; pointer events enabled. */
  readonly uiLayer: HTMLElement;
  /** Current scroll offset of the visible viewport inside the world, stage px. */
  readonly scrollY: number;
  readonly scrollX: number;
  /**
   * `defer`: the position (scrollY, viewport()) changes at once, the scroller is written in the
   * next render. A seek fast-forwards frames it does not draw, and a scroller write after the last
   * frame's DOM writes would force a layout every frame.
   */
  scrollTo(y: number, opts?: { smooth?: boolean; defer?: boolean }): void;
  /** User-initiated scrolls only (wheel/touch/keys), not programmatic scrollTo. */
  onUserScroll(fn: (y: number) => void): () => void;
  /** Resize of the visible viewport. */
  onResize(fn: (vp: Rect) => void): () => void;
  /** Show/hide the Figma-style rulers along the top and left edges. */
  setRulers(on: boolean): void;
  /**
   * Per-frame draw, called by the engine after it moved agents:
   * virtualization, transient overlays, cursor canvas. `now` is engine time (caret blink etc.).
   */
  render(now: number, agents: readonly AgentView[]): void;
  /**
   * Optional: a frame the engine simulated without drawing it (each seek step). The stage does
   * the per-frame bookkeeping of render() without drawing: task touches age and virtualization
   * runs, so a long seek keeps the mounted set as small as playback does.
   */
  skipFrame?(): void;
  /**
   * Optional read phase: the engine calls it at the start of every clock tick, before tasks write
   * to the DOM. The stage takes the layout reads it can do ahead of time (caret geometry of typed
   * text), so a task asking for them mid-frame does not force a layout after other agents' writes.
   */
  measure?(): void;
  /**
   * Optional: a task is about to start on layer `id` (the engine calls it when it hands the task
   * to an agent), so the stage can mount the layer and read what the task will need in the next
   * read phase.
   */
  prefetch?(id: string): void;
  /** Fade the blank canvas in over the live page (overlay) / show the empty stage (inline). */
  enter(): Promise<void>;
  /** Instantly reveal every layer to its final state (skip, reduced motion end). */
  finishAll(): void;
  /** Back to a blank canvas with nothing revealed (replay). */
  reset(): void;
  /** Overlay: sync window scroll, fade the stage out, then call opts.onDone. Inline: hide cursors and transient overlays, keep content. */
  goLive(): Promise<void>;
  /** Last pointer position in STAGE coordinates, or null when the pointer is outside / unknown. */
  pointer(): Point | null;
  /** Convert between stage and client (viewport) coordinates. */
  toClient(p: Point): Point;
  toStage(p: Point): Point;
  /** Resolves when assets of mounted layers are decoded (images, web fonts). */
  ready(): Promise<void>;
  destroy(): void;
}

/** src/stage/index.ts */
export type CreateStageFn = (opts: StageOptions) => Stage;

/*
 * Overlay prop schemas (StageApi.overlay(kind, props) / handle.update(props)).
 * All coordinates are STAGE coordinates. Colours are CSS colours; when omitted the stage
 * uses theme.select (rects/badges/selection) or theme.accent (guides/measure).
 *
 *  ghost-rect   { x, y, w, h, color?, radius?, fill?: boolean }     dashed outline + light gray placeholder
 *  size-badge   { x, y, text, color? }                             pill label, e.g. "320 × 48"; x,y = anchor (badge sits below-right)
 *  rubber-band  { x1, y1, x2, y2, color? }                         thin line from last anchor to cursor
 *  anchor       { x, y, color?, active?: boolean }                 small square pen anchor
 *  guide        { axis: "x" | "y", pos, color?, label?: string }   full-length ruler guide line; label like "x 120"
 *  measure      { a: Rect, b: Rect, color? }                        spacing lines + numeric gap labels between two rects
 *  selection    { x, y, w, h, color?, handles?: boolean, label?: string }
 *  caret        { x, y, h, color? }                                 blinking text caret (blink driven by `now` in render)
 *  icon         { x, y, size, src?: string, alpha?: number }        intro icon (blueprint.icon or a generic glyph)
 *  halo         { x, y, r, level: number, bands?: number[], colors?: string[], alpha? }  audio-reactive ring glow (alpha 0..1, default 1)
 */

/* ================================================================== */
/* choreo  (module: src/choreo/index.ts, owner: choreo)               */
/* ================================================================== */

/**
 * Built-in choreographies as a Plugin. Task keys:
 *   "box" | "text" | "path" | "image" | "media" | "guide" | "duplicate"
 * The engine runs tasks["duplicate"] for any layer with `master` set (any kind),
 * otherwise tasks[layer.kind], otherwise (custom) tasks[layer.task] from plugins, falling back to a fade.
 * Choreographies only use AgentApi + StageApi; timings are in engine ms and are scaled by the engine.
 * Each task must end with stage.finish(layer.id) and leave no overlays behind (remove handles in finally).
 */
/** src/choreo/index.ts exports `builtinPlugin: Plugin`. */
export type BuiltinPlugin = Plugin;

/**
 * The StageApi a task receives from the engine. The engine wraps the stage once per task, so the
 * stage object is no key for state shared across tasks. Optional extra (not in the public StageApi):
 * `build` is the same object for every task of one build and a new one after replay, so a
 * choreography can keep per-build state (e.g. the copies already finished) in a WeakMap keyed by it.
 */
export interface TaskStage extends StageApi {
  readonly build?: object;
}

/** Pure helpers the engine may reuse (exported from src/choreo/index.ts). */
export interface ChoreoHelpers {
  /** Estimated duration of a layer's task at speed 1 (planner uses it for ETA and tour pacing). */
  estimate(layer: Layer): number;
}
/** src/choreo/index.ts exports `choreoHelpers: ChoreoHelpers`. */

/* ================================================================== */
/* sound  (module: src/sound/index.ts, owner: sound)                  */
/* ================================================================== */

/**
 * Event semantics emitted by choreo/engine (SoundEvent.name, pitch meaning):
 *   key      pitch: none          vel: 0..1 (accent)     mechanical key click
 *   space    pitch: none                                 deeper key for space/return
 *   press    pitch: none                                 mouse button down
 *   release  pitch: none                                 mouse button up
 *   snap     pitch: none                                 guide snap click
 *   tick     pitch: step index 0..n                      rising tick while a heading grows
 *   note     pitch: 0..1 = small/high .. large/low is the CALLER's job: pass 1 - normalizedArea; sound maps to scale
 *            vel: 0..1                                    placement note (box/image/duplicate), quantized to the grid
 *   pen      pitch: none                                 pen anchor tick
 *   swell / fanout / chord / sweep / pop                 one-shots (see PLAN)
 * pan: -1..1 from the cursor's x within the viewport.
 * Notes are quantized to the eighth-note grid of `bpm` (default 112) when beatSync is true (default true for "note").
 * Quantization is a PURE function of event.t so realtime and offline renders match.
 */
export interface SoundEngine {
  play(ev: SoundEvent): void;
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  /** True while the AudioContext is suspended awaiting a user gesture (autoplay policy). */
  readonly locked: boolean;
  /** Try to resume; call from a user gesture handler. */
  unlock(): Promise<void>;
  onLockChange(fn: (locked: boolean) => void): () => void;
  /** Smoothed loudness 0..1 and ~16 band magnitudes 0..1 of the master bus (or microphone), for the halo finale. */
  levels(): { level: number; bands: Float32Array } | null;
  /** Optional microphone input for the halo finale. Resolves false if denied/unavailable. */
  useMicrophone(on: boolean): Promise<boolean>;
  destroy(): void;
}

/** src/sound/index.ts (createSound is internal; renderOffline/encodeWav/quantize are public exports) */
export type CreateSoundFn = (opts: SoundOptions) => SoundEngine;
export type QuantizeFn = (tMs: number, bpm: number) => number;
export type RenderOfflineFn = (
  events: readonly SoundEvent[],
  durationMs: number,
  opts?: { sampleRate?: number; pack?: string; volume?: number; bpm?: number },
) => Promise<AudioBuffer>;
export type EncodeWavFn = (buffer: AudioBuffer) => Uint8Array;

/* ================================================================== */
/* ui + i18n  (modules: src/ui/index.ts, src/i18n/index.ts, owner: ui) */
/* ================================================================== */

export interface I18n {
  readonly locale: string;
  t(key: string, vars?: Record<string, string | number>): string;
}

/** Supported: "zh-CN" (default fallback order: exact -> language -> en), "zh-TW", "en", "ja", "ko", "es", "fr", "de". */
/** src/i18n/index.ts exports `LOCALES: readonly string[]`. */
export type CreateI18nFn = (locale?: string) => I18n;

export interface ControlsOptions {
  /** Mount point (Stage.uiLayer). */
  host: HTMLElement;
  player: Player;
  i18n: I18n;
  chrome: "light" | "dark";
  /** Show the sound lock hint ("Tap for sound") when true. */
  soundLocked: () => boolean;
  onUnlockSound: () => void;
  /** Optional halo toggle and record button are shown only when provided. */
  onRecord?: () => void;
  /**
   * Optional (ui seam): current playback settings, so the toolbar mirrors PlayerOptions.speed/sound/follow
   * and changes made through the Player API. Without it the toolbar assumes 1x, sound on, follow "scroll"
   * and tracks only its own changes.
   */
  settings?: () => { speed: number; sound: boolean; follow: "scroll" | "tour" | "none" };
  /**
   * Optional (ui seam): Esc / close button handler, e.g. destroy the player and call PlayerOptions.onClose.
   * Default: player.destroy().
   */
  onClose?: () => void;
  /**
   * Optional (ui seam): CLIENT-space point where the build currently happens (swarm centroid or build
   * frontier). On dual-segment (foldable) screens the toolbar moves to the segment without it. Polled
   * about once a second, only while viewport segments exist.
   */
  focus?: () => Point | null;
  /**
   * Optional (ui seam): playback position in player ms (`elapsed` since play, and the expected
   * `duration` of the build; both 0 before play). When given and the player implements `seek()`,
   * the toolbar shows a keyboard-accessible seek bar that calls `seek(t)` on release.
   */
  timeline?: () => { elapsed: number; duration: number };
  /**
   * Optional (ui seam): the player's resolved reduced-motion setting (PlayerOptions.reducedMotion).
   * When true, the toolbar drops its slides, transitions and the sound hint's pulse even where the
   * OS does not ask for reduced motion (an app-level choice such as Studio's Motion setting). The
   * toolbar follows `prefers-reduced-motion` either way.
   */
  reducedMotion?: boolean;
}

/**
 * Floating toolbar: progress, play/pause, speed 1x/2x/3x, sound, tour, finish now, replay, go live,
 * close, and a seek bar when the `timeline` seam is given and the player can seek.
 * Keyboard: Esc close, Space pause/resume, M sound, T tour, 1/2/3 speed, R replay, L go live,
 * F finish now; arrows, Page Up/Down, Home and End on the focused seek bar.
 * Touch: tap empty stage toggles toolbar; buttons >= 44px hit area; respects safe-area insets
 * and avoids the fold when viewport segments are present. Auto-hides after inactivity while building.
 */
export interface Controls {
  setVisible(v: boolean): void;
  destroy(): void;
}
export type CreateControlsFn = (opts: ControlsOptions) => Controls;

/* ================================================================== */
/* engine  (owner: engine)                                            */
/* ================================================================== */

/**
 * src/player.ts: createPlayer(options) wires everything:
 *   resolveTheme -> createStage -> createSound -> createControls (if controls) -> Engine.
 * The engine implements AgentApi per cursor and produces AgentView[] every frame.
 *
 * Engine responsibilities (src/engine/**):
 *  - planner: task DAG (parent before child, master before duplicate, guide before snapping text),
 *    reading-order priority, viewport-first unlocking with lookahead, estimate() for ETA/tour pace.
 *  - scheduler: idle agents pick the best available task (near their position and the viewport),
 *    run its generator (yield ms | undefined | Promise), apply speed, pause, abort on replay/destroy.
 *  - agents: count from options or auto (8..64 from layer count and viewport area), names/labels,
 *    colours from theme.palette, natural motion (eased travel with slight overshoot/curvature from rng).
 *  - swarm: intro (orbit the icon, then fan out), idle wandering near work, follow scroll (more agents
 *    join when the user scrolls fast), tour (auto-scroll at the pace builds complete),
 *    finale flock (seek pointer with separation/alignment/cohesion, spatial hash grid, avoid pointer
 *    when too close), finale halo (concentric rings pulsing with sound.levels()), reduced-motion path.
 *  - player API, events, soundLog (every SoundEvent emitted), ready(), eta().
 */
export type CreatePlayerFn = (opts: import("./types").PlayerOptions) => Player;
