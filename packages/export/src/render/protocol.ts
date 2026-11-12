import type { Blueprint, LabelMode, OverlayLevel, SoundEvent } from "@swarmloom/core";

/** Input of a render: what `SourceInput` carries, serialisable across the driver boundary. */
export interface RenderInput {
  /** File name; its extension drives detection when the content is ambiguous. */
  name: string;
  /**
   * MIME type (contains "/"), or a format override: an adapter id ("markdown") or extension ("md").
   */
  type?: string;
  /** File content, base64. */
  base64?: string;
  text?: string;
  /** URL fetched by the page (http(s) or data:). */
  url?: string;
}

/** Player actions a render can schedule (see {@link RenderInit.cues}). */
export const CUE_ACTIONS = ["pause", "resume", "finish", "live", "speed"] as const;
export type CueAction = (typeof CUE_ACTIONS)[number];

/** Build speeds a render accepts: {@link RenderInit.speed} and "speed" cues. */
export const SPEED_RANGE = { min: 0.05, max: 16 } as const;

/** A player action applied at a fixed video time. */
export interface RenderCue {
  /** Video time in ms (frame `n` shows `n * 1000 / fps`); applied on the first frame at or after it. */
  at: number;
  /**
   * "pause" holds every cursor where it is, "resume" continues, "finish" completes the build quickly,
   * "live" goes live now instead of when the finale settles (the cursors leave and the page plays; an
   * unfinished build completes at once), also with `live: false`. "speed" sets the build speed to
   * {@link speed} from then on, as `Player.setSpeed` does (the intro and finale keep their pace).
   */
  action: CueAction;
  /** New build speed of a "speed" cue, 0.05..16; required by it and not allowed on the others. */
  speed?: number;
}

/** Options of `window.__swarmloom.init()`. Mirrors the CLI flags. */
export interface RenderInit {
  input: RenderInput;
  /** Viewport CSS px; deviceScaleFactor is set by the driver. */
  width: number;
  height: number;
  /** Used only to report; the driver calls `step(1000 / fps)`. */
  fps: number;
  agents?: number | "auto";
  speed?: number;
  /** Default 1, so two renders of the same input are identical. */
  seed?: number;
  theme?: "auto" | "light" | "dark";
  labels?: LabelMode;
  /**
   * Editing marks drawn while building: "full" (default), "minimal" (no size badges, distance
   * labels, guide lines or rulers) or "none" (cursors, name tags and content only).
   */
  overlays?: OverlayLevel;
  /** Default true. `false` renders a silent soundtrack. */
  sound?: boolean;
  finale?: "flock" | "halo" | "none";
  locale?: string;
  /** Hold time after the build completes (finale, then the live page), ms. Default 2500. */
  tail?: number;
  /**
   * Go live once the finale settles, as the player's go live does: the cursors leave, the stage
   * becomes the finished page and its own animations (CSS, SMIL, plugin players such as Lottie)
   * play through the rest of the tail on the frame clock. An HTML document shows its live page
   * (the adapter's `keepLive` frame). Default true; ignored with `reducedMotion`, which keeps the
   * end state.
   */
  live?: boolean;
  /** Scroll mode during export: "tour" (default; follows the build) or "none". */
  follow?: "tour" | "none";
  /** Quick cross-fade build without flocking. Default false: exports never inherit the host preference. */
  reducedMotion?: boolean;
  /** Musical grid tempo of placement notes (beat-synced builds). Default: the sound pack's tempo. */
  bpm?: number;
  /**
   * What snaps to that grid in the soundtrack (`SoundOptions.beatSync`): true (default) the notes,
   * fan-out and final chord; "all" also keys, clicks, snaps and pen anchors, on sixteenth notes.
   */
  beatSync?: true | "all";
  /** Sound pack id ("studio", "soft", "8bit", "silent-keys"). Default "studio". */
  pack?: string;
  /** Player actions at fixed video times, e.g. a hold and a quick finish timed to music. Default none. */
  cues?: RenderCue[];
  /**
   * A blueprint the driver already captured (the CLI snapshots live web pages). When set it is played
   * as is and `input` is not loaded; `input` still names the source.
   */
  blueprint?: Blueprint;
}

/** What `init()` reports about the loaded input. */
export interface RenderInfo {
  /** Estimated length of the whole video (build plus tail), ms; 0 when unknown. */
  estimatedMs: number;
  /** Number of layers in the blueprint. */
  layers: number;
  /**
   * SHA-256 (hex) of the blueprint's JSON, so a capture can record exactly what was played. Addresses
   * that differ between runs are normalized first (the directory the driver served the input from,
   * other addresses on the render page's origin, blob: URLs), so the same input and settings give the
   * same hash every time. Empty without Web Crypto.
   */
  blueprintSha256: string;
}

/** Result of one `step()` call. */
export interface RenderStep {
  /** Player state ("intro", "building", "finale", "done", ...). */
  state: string;
  built: number;
  total: number;
  /** True once the build finished AND `tail` ms elapsed. */
  done: boolean;
}

/** The protocol the CLI drives through Playwright on `dist/render/index.html`. */
export interface RenderApi {
  /**
   * Loads the input with a VirtualClock and controls off; the first frame (t = 0) is ready when it
   * resolves (and painted, on the CLI's render page, which waits for an animation frame).
   */
  init(o: RenderInit): Promise<RenderInfo>;
  /**
   * Advances the clock by `ms` and resolves once `player.ready()` has resolved for the new frame (and,
   * on the CLI's render page, once the page has had an animation frame to paint it).
   */
  step(ms: number): Promise<RenderStep>;
  /**
   * Base64 WAV (48 kHz stereo, 16-bit) of the sound log rendered offline for `durationMs`. Pass the
   * video's length (frames * 1000 / fps): its last frame lasts one frame past the elapsed time, the default.
   */
  audioWav(durationMs?: number): Promise<string>;
  /**
   * Every sound event logged so far, the list `audioWav()` renders: engine ms on the frames' clock
   * (frame n shows n * 1000 / fps; time held by a "pause" cue is included). Logged even when sound
   * is off, so drivers can record or compare runs.
   */
  soundLog(): Promise<SoundEvent[]>;
  /** Destroys the player and releases the loaded source; `init()` may be called again afterwards. */
  dispose(): void;
}

declare global {
  interface Window {
    __swarmloom: RenderApi;
  }
}

const LABELS = ["names", "agents", "roles", "none"] as const;
const OVERLAYS = ["full", "minimal", "none"] as const;
const THEMES = ["auto", "light", "dark"] as const;
const FINALES = ["flock", "halo", "none"] as const;
const FOLLOWS = ["tour", "none"] as const;

function fail(message: string): never {
  throw new TypeError(`init(): ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function number(
  o: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  integer = false,
): number | undefined {
  const value = o[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${key} must be a number within ${min}..${max}, got ${JSON.stringify(value)}`);
  }
  if (integer && !Number.isInteger(value)) fail(`${key} must be an integer, got ${value}`);
  return value;
}

function oneOf<T extends string>(o: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined {
  const value = o[key];
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) fail(`${key} must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`);
  return value as T;
}

function optionalString(o: Record<string, unknown>, key: string): string | undefined {
  const value = o[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(`${key} must be a string`);
  return value;
}

/** Most cues one render accepts. */
const MAX_CUES = 1000;
/** Latest cue time, ms (one hour of video). */
const MAX_CUE_MS = 3_600_000;

function cueList(raw: unknown): RenderCue[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_CUES) fail(`cues must be an array of at most ${MAX_CUES} cues`);
  const cues = raw.map((cue, i) => {
    if (!isRecord(cue)) fail(`cues[${i}] must be an object`);
    const at = number(cue, "at", 0, MAX_CUE_MS) ?? fail(`cues[${i}].at is required`);
    const action = oneOf(cue, "action", CUE_ACTIONS) ?? fail(`cues[${i}].action is required`);
    if (action !== "speed") {
      if (cue.speed !== undefined) fail(`cues[${i}].speed is only for a "speed" cue`);
      return { at, action };
    }
    const speed = number(cue, "speed", SPEED_RANGE.min, SPEED_RANGE.max) ?? fail(`cues[${i}].speed is required`);
    return { at, action, speed };
  });
  // Stable: cues at the same time apply in the order given.
  return cues.sort((a, b) => a.at - b.at);
}

/** Shape check of a driver-supplied blueprint (untrusted JSON): version 1, finite size, a layer list. */
function blueprintOf(raw: unknown): Blueprint | undefined {
  if (raw === undefined) return undefined;
  const bp = raw as Partial<Blueprint> | null;
  const sized = Number.isFinite(bp?.size?.w) && Number.isFinite(bp?.size?.h);
  if (!isRecord(bp) || bp.version !== 1 || !Array.isArray(bp.layers) || !sized) {
    fail("blueprint must be a version 1 blueprint with a size and layers");
  }
  return bp as Blueprint;
}

/** Init options after validation, with defaults filled in. */
export type ParsedInit = RenderInit &
  Required<
    Pick<RenderInit, "seed" | "tail" | "live" | "sound" | "follow" | "reducedMotion" | "theme" | "cues" | "beatSync">
  >;

/**
 * Validates untrusted init options (they cross a process boundary) and fills defaults.
 *
 * @throws TypeError naming the offending field.
 */
export function parseInit(raw: unknown): ParsedInit {
  if (!isRecord(raw)) fail("options must be an object");
  const input = raw.input;
  if (!isRecord(input)) fail("input must be an object");
  const name = optionalString(input, "name");
  if (!name) fail("input.name must be a non-empty string");
  const source: RenderInput = {
    name,
    type: optionalString(input, "type"),
    base64: optionalString(input, "base64"),
    text: optionalString(input, "text"),
    url: optionalString(input, "url"),
  };
  if (source.base64 === undefined && source.text === undefined && !source.url) {
    fail("input needs base64, text or url");
  }
  const agents = raw.agents === "auto" ? "auto" : number(raw, "agents", 1, 256, true);
  const sound = raw.sound;
  if (sound !== undefined && typeof sound !== "boolean") fail("sound must be a boolean");
  const reducedMotion = raw.reducedMotion;
  if (reducedMotion !== undefined && typeof reducedMotion !== "boolean") fail("reducedMotion must be a boolean");
  const live = raw.live;
  if (live !== undefined && typeof live !== "boolean") fail("live must be a boolean");
  const beatSync = raw.beatSync;
  if (beatSync !== undefined && beatSync !== true && beatSync !== "all") fail('beatSync must be true or "all"');
  const blueprint = blueprintOf(raw.blueprint);
  return {
    input: source,
    width: number(raw, "width", 16, 8192, true) ?? fail("width is required"),
    height: number(raw, "height", 16, 8192, true) ?? fail("height is required"),
    fps: number(raw, "fps", 1, 240) ?? fail("fps is required"),
    agents,
    speed: number(raw, "speed", SPEED_RANGE.min, SPEED_RANGE.max),
    seed: number(raw, "seed", -(2 ** 31), 2 ** 32, true) ?? 1,
    theme: oneOf(raw, "theme", THEMES) ?? "auto",
    labels: oneOf(raw, "labels", LABELS),
    overlays: oneOf(raw, "overlays", OVERLAYS),
    sound: sound ?? true,
    finale: oneOf(raw, "finale", FINALES),
    locale: optionalString(raw, "locale"),
    tail: number(raw, "tail", 0, 600_000) ?? 2500,
    live: live ?? true,
    follow: oneOf(raw, "follow", FOLLOWS) ?? "tour",
    reducedMotion: reducedMotion ?? false,
    bpm: number(raw, "bpm", 20, 400),
    beatSync: beatSync ?? true,
    pack: optionalString(raw, "pack"),
    cues: cueList(raw.cues),
    ...(blueprint ? { blueprint } : {}),
  };
}
