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
  action: "pause" | "resume" | "finish" | "live";
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
  /** Opening: the finished content shows this long (ms), then fades into the blank canvas. */
  opening?: number;
  /** Go live once the finale settles: the finished page plays its own animations. Default true. */
  live?: boolean;
  /** Going live glides back to the top first. */
  liveTop?: boolean;
  follow?: "tour" | "none";
  /** Quick cross-fade build without flocking. */
  reducedMotion?: boolean;
  /** Musical grid tempo of placement notes. */
  bpm?: number;
  /** Sound pack id ("studio", "soft", "8bit", "silent-keys"). */
  pack?: string;
  /** Player actions at fixed video times (pause, resume, finish, live). */
  cues?: RenderCue[];
  /**
   * Optional CLI extension: a blueprint captured from a live page by the CLI (http/https URLs).
   * A render page that supports it plays this blueprint instead of loading `input`; one that does not
   * ignores it and falls back to `input` (the fetched HTML plus its URL).
   */
  blueprint?: Blueprint;
}

/** One stretch of scrolling: the view's top edge went `from` -> `to` (content px) between `t` and `end` (video ms). */
export interface RenderScroll {
  t: number;
  end: number;
  from: number;
  to: number;
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
  /** Every stretch of scrolling so far, on the frames' clock (optional: older render pages lack it). */
  scrollLog?(): Promise<RenderScroll[]>;
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

/**
 * Validates scrollLog() output (untrusted JSON) into stretches with a fixed key order.
 * @throws TypeError when it is not a list of stretches.
 */
export function asScrolls(value: unknown): RenderScroll[] {
  if (!Array.isArray(value)) throw new TypeError("render page returned an invalid scrollLog() result");
  return value.map((raw, i) => {
    const s = (raw ?? {}) as Partial<RenderScroll>;
    const fields = [s.t, s.end, s.from, s.to];
    if (!fields.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new TypeError(`render page returned an invalid scroll at index ${i}`);
    }
    return { t: s.t as number, end: s.end as number, from: s.from as number, to: s.to as number };
  });
}
