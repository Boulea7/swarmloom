/**
 * SwarmLoom public contract (packages/core/src/types.ts).
 *
 * Every package codes against these types. Changing a type here is an
 * architecture change: update all packages in the same commit.
 */

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** Axis-aligned rectangle in stage (world) CSS pixels. Origin = stage top-left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Inline CSS declarations, property names in kebab-case: { "background-color": "#fff" }. */
export type CSSMap = Record<string, string>;

/* ------------------------------------------------------------------ */
/* Blueprint: the format-neutral scene every adapter produces          */
/* ------------------------------------------------------------------ */

export type LayerKind = "box" | "text" | "path" | "image" | "media" | "guide" | "custom";

/**
 * Semantic hint used by the planner (ordering, grouping) and by
 * choreographies (e.g. headings grow while typed, cells fill row by row).
 * Free-form strings are allowed; these are the ones core understands.
 */
export type LayerRole =
  | "page"
  | "section"
  | "nav"
  | "heading"
  | "paragraph"
  | "list"
  | "list-item"
  | "quote"
  | "code"
  | "table"
  | "row"
  | "cell"
  | "figure"
  | "button"
  | "input"
  | "math"
  | "slide"
  | "shape"
  | "mesh"
  | (string & {});

export interface LayerBase {
  /** Unique within the blueprint. */
  id: string;
  kind: LayerKind;
  /** Bounds in stage coordinates. */
  box: Rect;
  /** Container layer that must be built before this one (and that clips it visually if `clip` is set). */
  parent?: string;
  /** This layer is a duplicate of `master`: built by alt-dragging a copy of the finished master. */
  master?: string;
  /** Paint order; higher is on top. Defaults to array index. */
  z?: number;
  role?: LayerRole;
  /** Lower builds earlier. Default: reading order (top-to-bottom, then left-to-right). */
  priority?: number;
  /** Visible region (ancestor overflow clip) in stage coordinates. */
  clip?: Rect;
  /** Rotation/skew etc. applied around the box centre, as a CSS transform string. */
  transform?: string;
  /** Final opacity 0..1 (default 1). */
  opacity?: number;
  /** Guide ids this layer snaps to while being built. */
  snaps?: string[];
  /** Adapter-specific data; never interpreted by core. */
  meta?: Record<string, unknown>;
}

/** A styled rectangle: fills, borders, radii, shadows, gradients, backdrop blur. */
export interface BoxLayer extends LayerBase {
  kind: "box";
  style: CSSMap;
}

export type TextReveal = "type" | "fade" | "stamp" | "none";

/** A block of text. `html` is a sanitized fragment with inline styles; `text` is its plain text used for typing. */
export interface TextLayer extends LayerBase {
  kind: "text";
  html: string;
  text: string;
  /** Styles of the text container (font, colour, alignment, line-height, padding...). */
  style: CSSMap;
  /** Computed font size in px; headings above ~28px grow while typed. */
  fontSize?: number;
  reveal?: TextReveal;
}

export type PathReveal = "pen" | "trace" | "fade";

/** Vector geometry: lines, borders drawn as strokes, SVG shapes. `d` is SVG path data in stage coordinates. */
export interface PathLayer extends LayerBase {
  kind: "path";
  d: string;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  /** Extra SVG presentation attributes (stroke-linecap, stroke-dasharray, fill-rule, opacity, ...). */
  attrs?: Record<string, string>;
  reveal?: PathReveal;
}

export type ImageReveal = "sweep" | "fade" | "paint" | "type";

/**
 * Raster or vector image. `src` is a URL, data: URL or blob: URL.
 * `crop` selects a source rectangle in source pixels (used to reveal regions of a rendered page bitmap).
 */
export interface ImageLayer extends LayerBase {
  kind: "image";
  src: string;
  crop?: Rect;
  /** Natural size of `src` in px when known (needed with `crop`). */
  natural?: Size;
  fit?: "fill" | "contain" | "cover";
  style?: CSSMap;
  reveal?: ImageReveal;
}

/** Video, iframe, canvas or embed that cannot be rebuilt: shown as a labelled placeholder or a snapshot. */
export interface MediaLayer extends LayerBase {
  kind: "media";
  label: string;
  /** Optional snapshot image of the element. */
  src?: string;
  style?: CSSMap;
}

/** Ruler guide that text snaps to (shared left edges, baselines). */
export interface GuideLayer extends LayerBase {
  kind: "guide";
  axis: "x" | "y";
  /** Position along the perpendicular axis, stage px. */
  pos: number;
}

/** Layer rendered and choreographed by a plugin (3D patches, spreadsheet cells, painted strokes, ...). */
export interface CustomLayer extends LayerBase {
  kind: "custom";
  /** Plugin-registered renderer/task name, e.g. "three:patch". */
  task: string;
  data?: unknown;
}

export type Layer = BoxLayer | TextLayer | PathLayer | ImageLayer | MediaLayer | GuideLayer | CustomLayer;

export interface BlueprintSource {
  /** Adapter id: "dom", "html", "markdown", "docx", "doc", "pdf", "svg", "image", "code", "sheet", "slides", "three", ... */
  type: string;
  name?: string;
  url?: string;
  title?: string;
}

export interface Blueprint {
  version: 1;
  source: BlueprintSource;
  /** World size; the stage scrolls vertically when taller than the viewport. */
  size: Size;
  /** Viewport size the blueprint was captured at (layout width matters for reflowable formats). */
  viewport?: Size;
  /** CSS background of the blank canvas (colour or gradient). */
  background: string;
  /** Text colour scheme of the content, used to pick cursor/overlay contrast. */
  scheme?: "light" | "dark";
  /** Style sheet text injected into the isolated stage (e.g. @font-face rules, a markdown theme). */
  css?: string;
  /** Icon shown at the centre during the intro orbit (favicon, file-type icon). */
  icon?: string;
  layers: Layer[];
  /** Plugin names this blueprint needs (resolved through PlayerOptions.plugins). */
  plugins?: string[];
  /** Set when the adapter dropped content because of limits. Shown to the user, never silent. */
  truncated?: { reason: string; dropped: number };
}

/* ------------------------------------------------------------------ */
/* Adapters: input -> Blueprint                                        */
/* ------------------------------------------------------------------ */

export interface SourceInput {
  name?: string;
  /** MIME type when known. */
  type?: string;
  bytes?: Uint8Array;
  text?: string;
  url?: string;
  /** Live DOM root (dom adapter, element embed). */
  element?: Element;
}

export interface AdapterContext {
  /** Document used for layout/measurement (hidden sandbox containers are created in it). */
  document: Document;
  /** Layout width for reflowable content (px). */
  width: number;
  theme: "light" | "dark";
  locale?: string;
  /** Upper bound on emitted layers; adapters set Blueprint.truncated when they hit it. */
  maxLayers?: number;
  signal?: AbortSignal;
}

export interface LoadedSource {
  blueprint: Blueprint;
  /** Plugins needed to play this blueprint (renderers/tasks for custom layers). */
  plugins?: Plugin[];
  /** Release object URLs, sandboxes, GPU resources. */
  dispose?(): void;
}

export interface Adapter {
  id: string;
  /** Human label, English; UI translates through i18n keys `format.<id>`. */
  label: string;
  extensions: string[];
  mime: string[];
  /** Optional magic-byte / content sniffing on the first bytes. */
  sniff?(head: Uint8Array, name?: string): boolean;
  load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource>;
}

/* ------------------------------------------------------------------ */
/* Time and randomness                                                 */
/* ------------------------------------------------------------------ */

/**
 * Drives the engine. RealtimeClock uses requestAnimationFrame;
 * VirtualClock advances only when `advance(ms)` is called (frame-exact export).
 */
export interface Clock {
  /** Milliseconds since start, scaled by nothing (speed is applied by the engine). */
  now(): number;
  /** Subscribe to ticks; `dt` in ms. Returns an unsubscribe function. */
  onTick(fn: (dt: number, now: number) => void): () => void;
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export interface VirtualClockLike extends Clock {
  advance(ms: number): void;
}

/** Seeded PRNG returning [0, 1). All engine randomness goes through one of these. */
export type Rng = () => number;

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

export type SoundName =
  | "key" // keystroke
  | "space" // space bar / return
  | "press" // mouse down
  | "release" // mouse up
  | "snap" // guide snap
  | "tick" // heading size step
  | "note" // musical note on box/image/duplicate placement
  | "pen" // pen-tool anchor
  | "swell" // page dissolves at start
  | "fanout" // swarm fans out
  | "chord" // build complete
  | "sweep" // go live
  | "pop" // small UI feedback
  | (string & {});

export interface SoundEvent {
  /** Engine time in ms (speed already applied). */
  t: number;
  name: SoundName;
  /** Stereo pan -1..1 (from cursor x). */
  pan: number;
  /** Semitone offset or scale degree, meaning depends on `name`. */
  pitch?: number;
  /** Velocity 0..1. */
  vel?: number;
}

export interface SoundOptions {
  enabled: boolean;
  /** 0..1 master volume. */
  volume?: number;
  /** Sound pack id: "studio" (default), "soft", "8bit", "silent-keys" (musical events only, no keys or clicks). */
  pack?: string;
  /** Musical grid tempo; notes and task starts quantize to it when `beatSync` is on. */
  bpm?: number;
  beatSync?: boolean;
}

/* ------------------------------------------------------------------ */
/* Choreography plugin API                                             */
/* ------------------------------------------------------------------ */

export type CursorShape = "arrow" | "crosshair" | "ibeam" | "pen" | "hand" | "grab" | "move" | "copy" | "resize";

export type Ease = "linear" | "inOut" | "out" | "in" | "spring";

/**
 * What a task generator may yield:
 *  - number: wait that many engine ms (speed-scaled by the engine)
 *  - undefined: wait one frame
 *  - Promise: wait for it (only for asset decoding; never for timing)
 */
export type Yield = number | undefined | Promise<unknown>;
export type TaskGen = Generator<Yield, void, unknown>;

/** Handle a choreography uses to drive one cursor. */
export interface AgentApi {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly rng: Rng;
  /** Travel to a stage point with natural motion; `yield* agent.moveTo(...)`. */
  moveTo(x: number, y: number, opts?: { dur?: number; ease?: Ease }): TaskGen;
  /** Move while the button is held (press/release are not implied). */
  dragTo(x: number, y: number, opts?: { dur?: number; ease?: Ease }): TaskGen;
  press(): void;
  release(): void;
  setCursor(shape: CursorShape): void;
  /** Short status bubble next to the cursor, e.g. "typing". Empty string hides it. */
  say(text: string): void;
  sound(name: SoundName, opts?: { pitch?: number; vel?: number }): void;
  /**
   * Optional. Current task time in engine ms: the timeline that yielded waits are measured in
   * (speed applied, same clock as SoundEvent.t). Lets choreographies keep tweens and typing bursts
   * exact when frames are coarser than the waits they asked for; without it they count steps.
   */
  now?(): number;
}

/** Transient overlay drawn above content (badges, ghosts, guides, measurements). */
export interface OverlayHandle {
  update(props: Record<string, unknown>): void;
  remove(): void;
}

export type OverlayKind =
  | "ghost-rect" // dashed/gray placeholder while dragging a box
  | "size-badge" // "W x H" label near the cursor
  | "rubber-band" // pen tool line from last anchor to cursor
  | "anchor" // pen anchor point
  | "guide" // ruler guide line
  | "measure" // spacing measurement between two rects
  | "selection" // selection outline with handles
  | "caret" // text caret
  | "icon" // intro icon the swarm orbits
  | "halo" // audio-reactive ring glow for the halo finale
  | (string & {});

/** Stage operations available to choreographies. */
export interface StageApi {
  readonly blueprint: Blueprint;
  layer(id: string): Layer | undefined;
  /** DOM element of a mounted layer (null when virtualized away or not DOM-rendered). */
  el(id: string): HTMLElement | SVGElement | null;
  /**
   * Set reveal progress 0..1 of a layer. Meaning per kind:
   * box: ghost -> filled at 1; text: typed character fraction; path: drawn length;
   * image: sweep/paint fraction; media: fade; custom: delegated to its renderer.
   */
  reveal(id: string, p: number): void;
  /** Mark layer complete (final styles, no transient state). */
  finish(id: string): void;
  /**
   * Transient inline styles on a mounted layer while it is being built
   * (e.g. a heading's font-size growing while typed, a duplicate's offset while dragged).
   * Pass null to clear. `finish` always clears transient styles.
   */
  setStyle(id: string, css: CSSMap | null): void;
  overlay(kind: OverlayKind, props: Record<string, unknown>): OverlayHandle;
  /** Current viewport rect in stage coordinates. */
  viewport(): Rect;
  /** Text geometry helper: caret position after `n` characters of a text layer (stage coords). */
  caretAt(id: string, n: number): Point;
}

export type TaskFn<L extends Layer = Layer> = (agent: AgentApi, layer: L, stage: StageApi) => TaskGen;

/** Renders custom layers; created once per layer when mounted. */
export interface LayerRenderer<L extends Layer = CustomLayer> {
  mount(layer: L, container: HTMLElement, stage: StageApi): HTMLElement | SVGElement | void;
  reveal(layer: L, p: number): void;
  finish?(layer: L): void;
  unmount?(layer: L): void;
}

/**
 * A plugin adds choreographies and/or renderers, keyed by layer kind
 * ("text", "box", ...) or by CustomLayer.task ("three:patch").
 * Plugins may also provide a full-stage backdrop (e.g. a WebGL canvas) via `stage`.
 */
export interface Plugin {
  name: string;
  tasks?: Record<string, TaskFn<any>>;
  renderers?: Record<string, LayerRenderer<any>>;
  /** Called once after the stage mounts; return a cleanup. Used for WebGL scenes, camera orbits, etc. */
  setup?(stage: StageApi, host: HTMLElement): void | (() => void);
  /** Called every frame with engine time. */
  frame?(now: number, dt: number): void;
  /** Map a stage point to a screen point (3D projection). Default identity. */
  project?(p: Point): Point;
}

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */

export type PlayerState = "idle" | "intro" | "building" | "paused" | "finale" | "done" | "live" | "destroyed";

export type LabelMode = "names" | "agents" | "roles" | "none";

export interface ThemeSpec {
  /** Cursor colours, cycled across agents. */
  palette?: string[];
  /** Overlay accent (guides, measurements). */
  accent?: string;
  /** Selection / size-badge colour. */
  select?: string;
  /** "light" | "dark" chrome for toolbar and badges. */
  chrome?: "light" | "dark" | "auto";
}

export interface PlayerOptions {
  blueprint: Blueprint;
  /**
   * "overlay": covers the live page viewport, follows document scrolling (extension).
   * "inline": renders inside `host`, which scrolls internally (Studio, embeds, export).
   */
  mode?: "overlay" | "inline";
  /** Element the isolated shadow root is attached to. Default document.body for overlay. */
  host?: HTMLElement;
  /** Number of cursors, or "auto" (scaled by layer count and viewport, 8..64). */
  agents?: number | "auto";
  /** Build speed multiplier (1, 2, 3, or any > 0). */
  speed?: number;
  seed?: number;
  clock?: Clock;
  sound?: boolean | SoundOptions;
  theme?: "auto" | "light" | "dark" | ThemeSpec;
  labels?: LabelMode | string[];
  /** "scroll": swarm follows user scrolling; "tour": auto-scroll at build pace; "none": static. */
  follow?: "scroll" | "tour" | "none";
  /** "auto" follows prefers-reduced-motion: quick cross-fade build, no flocking. */
  reducedMotion?: "auto" | boolean;
  intro?: boolean;
  /** End-of-build behaviour: flock to pointer, audio-reactive halo ring, or nothing. */
  finale?: "flock" | "halo" | "none";
  /** Built-in toolbar (play/pause, speed, sound, tour, replay, go live, close). */
  controls?: boolean;
  /**
   * Adds a seek bar to the built-in toolbar (drag or arrow keys to jump through the build). Shown
   * only with `controls` on; default false. Each seek replays the build from the start.
   */
  scrubber?: boolean;
  /** BCP 47 tag for toolbar strings; defaults to navigator.language. */
  locale?: string;
  plugins?: Plugin[];
  /** Restore the real page (overlay mode) or show the final content (inline) when done/closed. */
  onLive?: () => void;
  onClose?: () => void;
}

export type PlayerEvent =
  | { type: "state"; state: PlayerState }
  | { type: "progress"; built: number; total: number }
  | { type: "sound"; event: SoundEvent }
  | { type: "error"; error: Error };

export interface Player {
  readonly state: PlayerState;
  readonly progress: { built: number; total: number };
  /** Every sound event emitted so far (for offline audio rendering of exports). */
  readonly soundLog: readonly SoundEvent[];
  /** Starts intro + build. Resolves when the build (not the finale) completes. */
  play(): Promise<void>;
  pause(): void;
  resume(): void;
  setSpeed(speed: number): void;
  setSound(enabled: boolean): void;
  setFollow(mode: "scroll" | "tour" | "none"): void;
  replay(): void;
  /** Fade back to the real page (overlay) or the final static content (inline). */
  goLive(): void;
  destroy(): void;
  on<T extends PlayerEvent["type"]>(type: T, fn: (e: Extract<PlayerEvent, { type: T }>) => void): () => void;
  /** Estimated remaining build time in engine ms at current speed. */
  eta(): number;
  /**
   * Resolves when every asset of the currently mounted layers is decoded
   * (images, fonts). Exporters await it before capturing a frame.
   */
  ready(): Promise<void>;
  /**
   * Optional. Completes the build quickly: running tasks stop and the remaining layers fade in
   * within about a second, then the finale starts (toolbar "finish", key F).
   */
  finish?(): void;
  /**
   * Optional. Jumps to `t` ms of player time since play() by replaying from the start in 60 Hz
   * steps (Studio scrubber). Nothing is drawn or played while seeking; soundLog is kept complete.
   */
  seek?(t: number): void;
  /** Optional. Changes the end-of-build behaviour; applies immediately while the finale runs. */
  setFinale?(mode: "flock" | "halo" | "none"): void;
}
