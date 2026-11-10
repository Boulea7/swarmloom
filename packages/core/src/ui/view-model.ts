/**
 * Pure toolbar state: which controls exist in each player phase, and what they show.
 * Both the renderer and the keyboard dispatcher read availability from here so a shortcut never
 * does something the visible toolbar would not offer.
 */

import type { MessageKey } from "../i18n/messages/en";
import type { I18n } from "../internal";
import type { PlayerState } from "../types";

export type FollowMode = "scroll" | "tour" | "none";

/** Playback settings the toolbar mirrors. */
export interface Settings {
  speed: number;
  sound: boolean;
  follow: FollowMode;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { speed: 1, sound: true, follow: "scroll" };

/** Speeds offered by the segmented control and the 1/2/3 keys. */
export const SPEEDS = [1, 2, 3] as const;

export type Phase = "idle" | "running" | "paused" | "done" | "live" | "gone";

export function phaseOf(state: PlayerState): Phase {
  switch (state) {
    case "idle":
      return "idle";
    case "intro":
    case "building":
      return "running";
    case "paused":
      return "paused";
    case "finale":
    case "done":
      return "done";
    case "live":
      return "live";
    default:
      return "gone";
  }
}

export type Command =
  | { kind: "close" }
  | { kind: "togglePlay" }
  /**
   * `lockedAtPress`: audio was still locked when the press that produced this command began. The
   * page-wide unlock listener resumes audio on that press, so by the time the click arrives the
   * lock may be gone; the press must still count as "unlock", never as "mute".
   */
  | { kind: "toggleSound"; lockedAtPress?: boolean }
  | { kind: "toggleTour" }
  | { kind: "speed"; speed: number }
  | { kind: "replay" }
  | { kind: "goLive" }
  | { kind: "record" };

export type CommandKind = Command["kind"];

const AVAILABLE: Readonly<Record<CommandKind, ReadonlySet<Phase>>> = {
  close: new Set(["idle", "running", "paused", "done", "live"]),
  togglePlay: new Set(["idle", "running", "paused"]),
  toggleSound: new Set(["idle", "running", "paused", "done"]),
  toggleTour: new Set(["idle", "running", "paused"]),
  speed: new Set(["idle", "running", "paused"]),
  replay: new Set(["running", "paused", "done", "live"]),
  goLive: new Set(["running", "paused", "done"]),
  record: new Set(["idle", "running", "paused", "done"]),
};

/** Whether a command does anything in this phase (keyboard and buttons share this rule). */
export function isAvailable(kind: CommandKind, phase: Phase): boolean {
  return AVAILABLE[kind].has(phase);
}

export interface ViewInput {
  state: PlayerState;
  built: number;
  total: number;
  /** Remaining build time in ms (Player.eta()); non-finite or <= 0 means unknown. */
  etaMs: number;
  settings: Settings;
  soundLocked: boolean;
  compact: boolean;
  canRecord: boolean;
}

export interface ToolbarView {
  phase: Phase;
  /** 0..1 ring fill. */
  fraction: number;
  /** Integer 0..100. */
  percent: number;
  /** Tooltip and aria-valuetext of the progress ring. */
  progressText: string;
  play: { visible: boolean; icon: "play" | "pause"; label: string };
  speed: { visible: boolean; value: number };
  sound: { visible: boolean; on: boolean; hint: boolean; label: string };
  tour: { visible: boolean; on: boolean };
  replay: boolean;
  goLive: { visible: boolean; primary: boolean };
  record: boolean;
  close: boolean;
  /** Phases in which the toolbar never auto-hides. */
  pinned: boolean;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Narrows the contract's free-form `t` to known keys so typos fail to compile. */
export function translator(i18n: I18n): Translate {
  return (key, vars) => i18n.t(key, vars);
}

/** "12 seconds" / "2 minutes"; null when unknown. Rounds coarsely so the tooltip does not flicker. */
export function formatDuration(t: Translate, ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const seconds = ms / 1000;
  if (seconds < 10) return t("time.seconds", { count: Math.max(1, Math.ceil(seconds)) });
  if (seconds < 60) return t("time.seconds", { count: Math.min(55, Math.round(seconds / 5) * 5) });
  return t("time.minutes", { count: Math.max(1, Math.round(seconds / 60)) });
}

export function buildView(input: ViewInput, t: Translate): ToolbarView {
  const phase = phaseOf(input.state);
  const total = Math.max(0, Math.floor(finiteOr(input.total, 0)));
  const built = Math.min(total, Math.max(0, Math.floor(finiteOr(input.built, 0))));
  const finished = phase === "done" || phase === "live";
  const fraction = finished ? 1 : total > 0 ? built / total : 0;
  const percent = finished ? 100 : Math.min(99, Math.floor(fraction * 100));
  const active = phase === "running" || phase === "paused";
  const { settings } = input;
  const soundHint = input.soundLocked && settings.sound && isAvailable("toggleSound", phase);

  return {
    phase,
    fraction,
    percent,
    progressText: progressText(t, phase, built, total, input.etaMs),
    play: {
      visible: isAvailable("togglePlay", phase),
      icon: phase === "running" ? "pause" : "play",
      label: t(phase === "running" ? "toolbar.pause" : phase === "paused" ? "toolbar.resume" : "toolbar.play"),
    },
    speed: { visible: isAvailable("speed", phase), value: settings.speed },
    sound: {
      visible: isAvailable("toggleSound", phase),
      on: settings.sound,
      hint: soundHint,
      label: t(soundHint ? "toolbar.tapForSound" : "toolbar.sound"),
    },
    tour: { visible: isAvailable("toggleTour", phase), on: settings.follow === "tour" },
    // While building, replay and go live are secondary: keyboard-only on narrow screens.
    replay: isAvailable("replay", phase) && !(active && input.compact),
    goLive: { visible: isAvailable("goLive", phase) && !(active && input.compact), primary: phase === "done" },
    record: input.canRecord && isAvailable("record", phase),
    close: isAvailable("close", phase),
    pinned: phase !== "running" || soundHint,
  };
}

function progressText(t: Translate, phase: Phase, built: number, total: number, etaMs: number): string {
  if (phase === "done" || phase === "live") return t("progress.done", { count: total });
  if (total === 0) return t("progress.preparing");
  const layers = t("progress.layers", { built, count: total });
  const time = phase === "running" || phase === "paused" ? formatDuration(t, etaMs) : null;
  if (!time) return layers;
  return `${layers} · ${t(phase === "paused" ? "progress.etaPaused" : "progress.eta", { time })}`;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
