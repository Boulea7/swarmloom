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
  sound?: boolean;
  finale?: "flock" | "halo" | "none";
  locale?: string;
  /** Hold time after the build completes (finale), ms. */
  tail?: number;
  follow?: "tour" | "none";
  /** Quick cross-fade build without flocking. */
  reducedMotion?: boolean;
  /** Musical grid tempo of placement notes. */
  bpm?: number;
  /** Sound pack id ("studio", "soft", "8bit", "silent-keys"). */
  pack?: string;
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

export interface RenderApi {
  init(o: RenderInit): Promise<{ estimatedMs: number }>;
  step(ms: number): Promise<StepResult>;
  /** Base64 WAV of the sound log rendered offline for the elapsed duration. */
  audioWav(): Promise<string>;
  /** Every sound event logged so far (optional: older render pages lack it). */
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
