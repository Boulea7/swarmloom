import type { LabelMode, PlayerOptions } from "@swarmloom/core";

/** Every locale Studio ships strings for, in menu order. */
export const STUDIO_LOCALES = ["zh-CN", "zh-TW", "en", "ja", "ko", "es", "fr", "de"] as const;
export type StudioLocale = (typeof STUDIO_LOCALES)[number];

export type ThemeChoice = "auto" | "light" | "dark";
export type FinaleChoice = "flock" | "halo" | "none";
export type FollowChoice = "tour" | "scroll" | "none";
export type MotionChoice = "auto" | "reduce" | "full";
export type SoundPack = "studio" | "soft" | "8bit" | "silent-keys";

/** User preferences, persisted in localStorage and partly overridable from the URL. */
export interface StudioSettings {
  agents: "auto" | number;
  speed: number;
  seed: number;
  labels: LabelMode;
  theme: ThemeChoice;
  finale: FinaleChoice;
  follow: FollowChoice;
  /** Show the finished original for {@link OPENING_MS} first, then fade into the build. */
  opening: boolean;
  /** Going live glides back to the top. */
  liveTop: boolean;
  reducedMotion: MotionChoice;
  sound: boolean;
  soundPack: SoundPack;
  volume: number;
  locale: "auto" | StudioLocale;
  /**
   * Let documents load https images and fonts (no referrer). Every other request stays blocked.
   * Off keeps opened files fully offline (contracts/decisions-v1.md C03).
   */
  remoteAssets: boolean;
}

export const AGENT_RANGE = { min: 4, max: 64 } as const;
export const SPEED_RANGE = { min: 0.25, max: 4 } as const;
export const SPEED_STEPS = [0.5, 1, 2, 3] as const;
export const LABEL_MODES: readonly LabelMode[] = ["names", "agents", "roles", "none"];
export const THEMES: readonly ThemeChoice[] = ["auto", "light", "dark"];
export const FINALES: readonly FinaleChoice[] = ["flock", "halo", "none"];
export const FOLLOWS: readonly FollowChoice[] = ["tour", "scroll", "none"];
export const MOTIONS: readonly MotionChoice[] = ["auto", "reduce", "full"];
export const SOUND_PACKS: readonly SoundPack[] = ["studio", "soft", "8bit", "silent-keys"];
/** How long the opening shows the original before it fades, ms (`--opening 1.5`). */
export const OPENING_MS = 1500;

export const DEFAULT_SETTINGS: Readonly<StudioSettings> = Object.freeze({
  agents: "auto",
  speed: 1,
  seed: 1,
  labels: "names",
  theme: "auto",
  finale: "flock",
  follow: "tour",
  opening: false,
  liveTop: false,
  reducedMotion: "auto",
  sound: true,
  soundPack: "studio",
  volume: 0.8,
  locale: "auto",
  remoteAssets: true,
});

const STORAGE_KEY = "swarmloom.studio.settings.v1";

function oneOf<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

function finiteIn(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/** Parses an agent count: "auto" or an integer within {@link AGENT_RANGE}. */
export function parseAgents(value: unknown): "auto" | number | undefined {
  if (value === "auto") return "auto";
  const n = finiteIn(value, AGENT_RANGE.min, AGENT_RANGE.max);
  return n === undefined ? undefined : Math.round(n);
}

/** Parses a seed: a non-negative integer that fits in 32 bits. */
export function parseSeed(value: unknown): number | undefined {
  const n = finiteIn(value, 0, 0xffffffff);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

function parseBool(value: unknown): boolean | undefined {
  if (value === true || value === "1" || value === "true") return true;
  if (value === false || value === "0" || value === "false") return false;
  return undefined;
}

/**
 * Validates an untrusted settings object field by field (stored JSON, URL parameters).
 * Unknown fields and invalid values are dropped, so the result is always safe to merge.
 */
export function sanitizeSettings(raw: unknown): Partial<StudioSettings> {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<StudioSettings> = {};
  const agents = parseAgents(r.agents);
  if (agents !== undefined) out.agents = agents;
  const speed = finiteIn(r.speed, SPEED_RANGE.min, SPEED_RANGE.max);
  if (speed !== undefined) out.speed = speed;
  const seed = parseSeed(r.seed);
  if (seed !== undefined) out.seed = seed;
  const labels = oneOf(LABEL_MODES, r.labels);
  if (labels) out.labels = labels;
  const theme = oneOf(THEMES, r.theme);
  if (theme) out.theme = theme;
  const finale = oneOf(FINALES, r.finale);
  if (finale) out.finale = finale;
  const follow = oneOf(FOLLOWS, r.follow);
  if (follow) out.follow = follow;
  const opening = parseBool(r.opening);
  if (opening !== undefined) out.opening = opening;
  const liveTop = parseBool(r.liveTop);
  if (liveTop !== undefined) out.liveTop = liveTop;
  const motion = oneOf(MOTIONS, r.reducedMotion);
  if (motion) out.reducedMotion = motion;
  const sound = parseBool(r.sound);
  if (sound !== undefined) out.sound = sound;
  const pack = oneOf(SOUND_PACKS, r.soundPack);
  if (pack) out.soundPack = pack;
  const volume = finiteIn(r.volume, 0, 1);
  if (volume !== undefined) out.volume = volume;
  const locale = r.locale === "auto" ? "auto" : oneOf(STUDIO_LOCALES, r.locale);
  if (locale) out.locale = locale;
  const remote = parseBool(r.remoteAssets);
  if (remote !== undefined) out.remoteAssets = remote;
  return out;
}

/** Reads persisted settings; corrupt or missing storage yields the defaults. */
export function loadSettings(storage: Pick<Storage, "getItem"> | undefined): StudioSettings {
  let stored: unknown = null;
  try {
    const text = storage?.getItem(STORAGE_KEY);
    stored = text ? JSON.parse(text) : null;
  } catch {
    // Private mode, quota or corrupt JSON: fall back to defaults.
    stored = null;
  }
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(stored) };
}

/** Persists settings; storage failures (private mode, quota) are ignored on purpose. */
export function saveSettings(storage: Pick<Storage, "setItem"> | undefined, settings: StudioSettings): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings simply do not persist in this session.
  }
}

/** Settings that the running player can change without a rebuild. */
export const LIVE_SETTINGS: ReadonlySet<keyof StudioSettings> = new Set(["speed", "sound", "follow"]);

/** Settings whose change requires reloading the source (adapters lay content out per theme and network policy). */
export const RELOAD_SETTINGS: ReadonlySet<keyof StudioSettings> = new Set(["theme", "remoteAssets"]);

/** What a settings change needs: nothing, a live player call, a new player, or a new load. */
export type SettingsImpact = "none" | "live" | "rebuild" | "reload";

/** Classifies the change from `prev` to `next` by its most expensive consequence. */
export function impactOf(prev: StudioSettings, next: StudioSettings): SettingsImpact {
  let changed = false;
  let rebuild = false;
  for (const key of Object.keys(next) as (keyof StudioSettings)[]) {
    if (prev[key] === next[key]) continue;
    if (RELOAD_SETTINGS.has(key)) return "reload";
    changed = true;
    if (!LIVE_SETTINGS.has(key)) rebuild = true;
  }
  return rebuild ? "rebuild" : changed ? "live" : "none";
}

/** Maps Studio settings to core player options (everything except blueprint, host and plugins). */
export function playerOptionsFrom(
  s: StudioSettings,
  locale: string,
): Pick<
  PlayerOptions,
  | "agents"
  | "speed"
  | "seed"
  | "labels"
  | "theme"
  | "finale"
  | "follow"
  | "opening"
  | "liveTop"
  | "reducedMotion"
  | "sound"
  | "locale"
> {
  return {
    agents: s.agents,
    speed: s.speed,
    seed: s.seed,
    labels: s.labels,
    theme: s.theme,
    finale: s.finale,
    follow: s.follow,
    opening: s.opening ? OPENING_MS : 0,
    liveTop: s.liveTop,
    reducedMotion: s.reducedMotion === "auto" ? "auto" : s.reducedMotion === "reduce",
    sound: s.sound ? { enabled: true, pack: s.soundPack, volume: s.volume } : false,
    locale,
  };
}
