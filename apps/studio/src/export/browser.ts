import type { RenderInput } from "@swarmloom/export";
import type { ExportSettings } from "@swarmloom/export/browser";
import { OPENING_MS, type StudioSettings } from "../settings";
import type { OpenedSource } from "../source";
import { stem } from "./cli";

/**
 * Longest video the export dialog makes, in seconds: the in-page export stops there, and the
 * command line gets it as `--max-duration` (the CLI's own default is 120 s). The `export.web.partial`
 * message names this limit.
 */
export const EXPORT_MAX_SECONDS = 600;

/** Frame rates the export dialog offers. */
export const EXPORT_FPS = [30, 60] as const;
export type ExportFps = (typeof EXPORT_FPS)[number];

/**
 * True when the browser has WebCodecs video encoding, so the dialog can offer an in-page export.
 * The same check as `hasWebCodecs` of `@swarmloom/export/browser`, kept here so that asking does
 * not load the exporter.
 */
export function canEncodeInBrowser(scope: object = globalThis): boolean {
  const s = scope as { VideoEncoder?: unknown; VideoFrame?: unknown };
  return typeof s.VideoEncoder === "function" && typeof s.VideoFrame === "function";
}

/** The opened source as the render page takes it (the same input the CLI command names). */
export function renderInputOf(opened: OpenedSource, toBase64: (bytes: Uint8Array) => string): RenderInput {
  const { input } = opened;
  const out: RenderInput = { name: input.name ?? opened.name };
  if (input.type) out.type = input.type;
  if (input.text !== undefined) out.text = input.text;
  else if (input.bytes) out.base64 = toBase64(input.bytes);
  if (input.url) out.url = input.url;
  return out;
}

/** What the export dialog adds to the settings. */
export interface ExportChoices {
  sound: boolean;
  /** Colour scheme in effect; "auto" exports what the preview shows. */
  scheme: "light" | "dark";
  locale: string;
}

/**
 * Player settings of an in-page export: the flags `buildCliCommand` writes, so the command line
 * renders the same file. Exports use the CLI defaults for what has no flag (no reduced motion,
 * the default tail), except the sound pack.
 */
export function exportSettingsOf(s: StudioSettings, choices: ExportChoices): ExportSettings {
  const settings: ExportSettings = {
    seed: s.seed,
    speed: s.speed,
    agents: s.agents,
    theme: s.theme === "auto" ? choices.scheme : s.theme,
    labels: s.labels,
    finale: s.finale,
    follow: s.follow === "none" ? "none" : "tour",
    sound: choices.sound,
    pack: s.soundPack,
    locale: choices.locale,
  };
  if (s.opening) settings.opening = OPENING_MS;
  if (s.liveTop) settings.liveTop = true;
  return settings;
}

/** Download name: the source's stem plus the container's extension. */
export function exportFileName(name: string, extension: string): string {
  return `${stem(name)}.${extension}`;
}

/** "1:05" from ms, rounded up so a countdown never shows 0:00 while work remains. */
export function clockOf(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
