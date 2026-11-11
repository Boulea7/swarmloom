/**
 * User preferences: schema, validation, storage and the mapping to PlayerOptions.
 *
 * Stored data stays tiny (one small object). It is written to `storage.local` and, when the browser
 * has it, mirrored to `storage.sync` (Safari exposes sync but does not sync it). Reads pick the
 * most recently saved copy, so a failed sync write never hides a newer local value.
 */

import type { LabelMode, PlayerOptions } from "@swarmloom/core";
import type { ExtensionApi, StorageArea } from "./api";
import { LOCALES, type Locale } from "./i18n";

export type SoundPack = "studio" | "soft" | "8bit" | "silent-keys";
export type MotionPref = "auto" | "on" | "off";

export interface Prefs {
  /** Build speed multiplier, 0.5..3. */
  speed: number;
  /** Cursor count or "auto". */
  agents: "auto" | number;
  labels: LabelMode;
  theme: "auto" | "light" | "dark";
  sound: boolean;
  soundPack: SoundPack;
  /** Master volume 0..1. */
  volume: number;
  finale: "flock" | "halo" | "none";
  reducedMotion: MotionPref;
  locale: "auto" | Locale;
}

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  speed: 1,
  agents: "auto",
  labels: "names",
  theme: "auto",
  sound: true,
  soundPack: "studio",
  volume: 0.8,
  finale: "flock",
  reducedMotion: "auto",
  locale: "auto",
});

export const SPEED_RANGE = { min: 0.5, max: 3 } as const;
export const AGENT_RANGE = { min: 4, max: 64 } as const;
export const SOUND_PACKS: readonly SoundPack[] = ["studio", "soft", "8bit", "silent-keys"];
export const LABEL_MODES: readonly LabelMode[] = ["names", "agents", "roles", "none"];
export const THEMES: readonly Prefs["theme"][] = ["auto", "light", "dark"];
export const FINALES: readonly Prefs["finale"][] = ["flock", "halo", "none"];
export const MOTION_PREFS: readonly MotionPref[] = ["auto", "on", "off"];

/** Storage key of the saved record `{ prefs, savedAt }`. */
export const PREFS_KEY = "prefs";

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Validates untrusted stored or submitted data. Unknown keys are dropped; each invalid field falls
 * back to its default independently, so one bad value never resets the rest.
 */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  const agents =
    r.agents === "auto"
      ? "auto"
      : typeof r.agents === "number" && Number.isFinite(r.agents)
        ? Math.round(clampNumber(r.agents, AGENT_RANGE.min, AGENT_RANGE.max, AGENT_RANGE.min))
        : d.agents;
  return {
    speed: clampNumber(r.speed, SPEED_RANGE.min, SPEED_RANGE.max, d.speed),
    agents,
    labels: oneOf(r.labels, LABEL_MODES, d.labels),
    theme: oneOf(r.theme, THEMES, d.theme),
    sound: typeof r.sound === "boolean" ? r.sound : d.sound,
    soundPack: oneOf(r.soundPack, SOUND_PACKS, d.soundPack),
    volume: clampNumber(r.volume, 0, 1, d.volume),
    finale: oneOf(r.finale, FINALES, d.finale),
    reducedMotion: oneOf(r.reducedMotion, MOTION_PREFS, d.reducedMotion),
    locale: oneOf<"auto" | Locale>(r.locale, ["auto", ...LOCALES], d.locale),
  };
}

interface SavedRecord {
  prefs: unknown;
  savedAt: number;
}

function readRecord(value: unknown): SavedRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const savedAt = (value as { savedAt?: unknown }).savedAt;
  return { prefs: (value as { prefs?: unknown }).prefs, savedAt: typeof savedAt === "number" ? savedAt : 0 };
}

async function readArea(area: StorageArea | undefined): Promise<SavedRecord | null> {
  if (!area) return null;
  try {
    return readRecord((await area.get(PREFS_KEY))[PREFS_KEY]);
  } catch {
    // A broken or disabled area (sync turned off by policy) must not block reading the other one.
    return null;
  }
}

/** Loads preferences, newest copy first; defaults when nothing valid is stored. */
export async function loadPrefs(api: Pick<ExtensionApi, "storage"> | null): Promise<Prefs> {
  if (!api) return { ...DEFAULT_PREFS };
  const [local, sync] = await Promise.all([readArea(api.storage.local), readArea(api.storage.sync)]);
  const newest = [local, sync].filter((r): r is SavedRecord => r !== null).sort((a, b) => b.savedAt - a.savedAt)[0];
  return sanitizePrefs(newest?.prefs);
}

/**
 * Saves preferences to local storage and mirrors them to sync storage when present.
 * @throws Error when the local write fails (the only copy that is guaranteed to exist).
 */
export async function savePrefs(
  api: Pick<ExtensionApi, "storage">,
  prefs: Prefs,
  savedAt: number = Date.now(),
): Promise<void> {
  const record = { [PREFS_KEY]: { prefs: sanitizePrefs(prefs), savedAt } };
  await api.storage.local.set(record);
  if (api.storage.sync) {
    try {
      await api.storage.sync.set(record);
    } catch (error) {
      // Quota or policy errors on sync are recoverable: the local copy is authoritative.
      console.warn("SwarmLoom: could not mirror settings to sync storage", error);
    }
  }
}

/**
 * `reduced-motion` attribute value of `<swarm-loom>` for a stored motion preference, so the
 * extension pages follow the same setting as the in-page swarm ("on" means always reduce).
 */
export function motionAttribute(pref: MotionPref): "auto" | "true" | "false" {
  if (pref === "auto") return "auto";
  return pref === "on" ? "true" : "false";
}

/** Small FNV-1a hash used to derive a stable per-page seed (no Math.random in playback paths). */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface PlayerEnvironment {
  /** False when the page has no WebAudio; sound is then disabled instead of shown as broken. */
  audio: boolean;
  /** Resolved UI locale (BCP 47). */
  locale: string;
  /** Seed for this run. */
  seed: number;
}

/** Maps stored preferences to player options for the in-page overlay. */
export function toPlayerOptions(prefs: Prefs, env: PlayerEnvironment): Partial<PlayerOptions> {
  return {
    mode: "overlay",
    agents: prefs.agents,
    speed: prefs.speed,
    seed: env.seed,
    labels: prefs.labels,
    theme: prefs.theme,
    sound: { enabled: prefs.sound && env.audio, pack: prefs.soundPack, volume: prefs.volume },
    finale: prefs.finale,
    reducedMotion: prefs.reducedMotion === "auto" ? "auto" : prefs.reducedMotion === "on",
    follow: "scroll",
    controls: true,
    locale: env.locale,
  };
}
