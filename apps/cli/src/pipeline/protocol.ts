/**
 * Render page protocol (owner: @swarmloom/export, contract in shells.md section 1).
 *
 * The CLI serves `@swarmloom/export/dist/render/` on 127.0.0.1 and drives `window.__swarmloom`
 * through Playwright. These types mirror that contract; the CLI only depends on this shape.
 */
import type { Blueprint, SoundEvent } from "@swarmloom/core";

export interface RenderInput {
  name: string;
  type?: string;
  base64?: string;
  text?: string;
  url?: string;
}

/** A player action at a fixed video time, ms (applied on the first frame at or after it). */
export interface RenderCue {
  at: number;
  action: "pause" | "resume" | "finish" | "live" | "speed";
  /** Build speed a "speed" cue sets from then on (0.05-16); only on "speed" cues. */
  speed?: number;
}

export interface RenderInit {
  input: RenderInput;
  /** Viewport CSS px; deviceScaleFactor is set by the driver. */
  width: number;
  height: number;
  /** Used only for reporting; the driver calls step(1000 / fps). */
  fps: number;
  agents?: number | "auto";
  speed?: number;
  seed?: number;
  theme?: "auto" | "light" | "dark";
  labels?: "names" | "agents" | "roles" | "none";
  /** Editing marks drawn while building (render pages without it draw them all). */
  overlays?: "full" | "minimal" | "none";
  sound?: boolean;
  finale?: "flock" | "halo" | "none";
  locale?: string;
  /** Hold time after the build completes (finale, then the live page), ms. */
  tail?: number;
  /** Go live once the finale settles: the finished page plays its own animations. Default true. */
  live?: boolean;
  follow?: "tour" | "none";
  /** Opening: true (the warp, default), "outline" (largest shapes first) or false (render pages without it play the warp). */
  intro?: boolean | "outline";
  /** Quick cross-fade build without flocking. */
  reducedMotion?: boolean;
  /** Musical grid tempo of placement notes. */
  bpm?: number;
  /** "all" also puts keys, clicks, snaps and pen anchors on sixteenth notes (render pages without it ignore it). */
  beatSync?: true | "all";
  /** Sound pack id ("studio", "soft", "8bit", "silent-keys"). */
  pack?: string;
  /** Player actions at fixed video times (pause, resume, finish, live, speed). */
  cues?: RenderCue[];
  /**
   * Optional CLI extension: a blueprint captured from a live page by the CLI (http/https URLs).
   * A render page that supports it plays this blueprint instead of loading `input`; one that does not
   * ignores it and falls back to `input` (the fetched HTML plus its URL).
   */
  blueprint?: Blueprint;
}

export interface StepResult {
  state: string;
  built: number;
  total: number;
  done: boolean;
}

/** What init() reports; render pages older than the capture evidence only send `estimatedMs`. */
export interface RenderInfo {
  estimatedMs: number;
  layers?: number;
  blueprintSha256?: string;
}

export interface RenderApi {
  init(o: RenderInit): Promise<RenderInfo>;
  step(ms: number): Promise<StepResult>;
  /** Base64 WAV of the sound log rendered offline for `durationMs` (default: the elapsed time). */
  audioWav(durationMs?: number): Promise<string>;
  /** Every sound event logged so far, on the frames' clock (optional: older render pages lack it). */
  soundLog?(): Promise<SoundEvent[]>;
  dispose(): void;
}

/** Global the render page installs. */
export const RENDER_API_GLOBAL = "__swarmloom";

/** Validates a step() result coming back from the page (untrusted JSON). */
export function asStepResult(value: unknown): StepResult {
  const v = value as Partial<StepResult> | null;
  if (!v || typeof v !== "object" || typeof v.done !== "boolean") {
    throw new TypeError("render page returned an invalid step() result");
  }
  return {
    state: typeof v.state === "string" ? v.state : "unknown",
    built: Number.isFinite(v.built) ? Number(v.built) : 0,
    total: Number.isFinite(v.total) ? Number(v.total) : 0,
    done: v.done,
  };
}

/** Validates init()'s result (untrusted JSON); unknown or malformed fields are dropped. */
export function asRenderInfo(value: unknown): RenderInfo {
  const v = (value ?? {}) as Partial<RenderInfo>;
  const estimate = Number(v.estimatedMs);
  const info: RenderInfo = { estimatedMs: Number.isFinite(estimate) && estimate > 0 ? estimate : 0 };
  if (Number.isInteger(v.layers) && Number(v.layers) >= 0) info.layers = Number(v.layers);
  if (typeof v.blueprintSha256 === "string" && /^[0-9a-f]{64}$/.test(v.blueprintSha256)) {
    info.blueprintSha256 = v.blueprintSha256;
  }
  return info;
}

/**
 * Validates soundLog() output (untrusted JSON) into events with a fixed key order, so the same
 * run always serialises to the same bytes.
 * @throws TypeError when it is not a list of events.
 */
export function asSoundEvents(value: unknown): SoundEvent[] {
  if (!Array.isArray(value)) throw new TypeError("render page returned an invalid soundLog() result");
  return value.map((raw, i) => {
    const e = raw as Partial<SoundEvent> | null;
    if (!e || typeof e.name !== "string" || typeof e.t !== "number" || !Number.isFinite(e.t)) {
      throw new TypeError(`render page returned an invalid sound event at index ${i}`);
    }
    const event: SoundEvent = { t: e.t, name: e.name, pan: typeof e.pan === "number" ? e.pan : 0 };
    if (typeof e.pitch === "number") event.pitch = e.pitch;
    if (typeof e.vel === "number") event.vel = e.vel;
    return event;
  });
}
