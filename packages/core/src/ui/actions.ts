/**
 * Executes toolbar commands against a Player. Buttons and shortcuts both go through here.
 */

import type { Player } from "../types";
import { type Command, DEFAULT_SETTINGS, type FollowMode, isAvailable, phaseOf, type Settings } from "./view-model";

/** finish() and seek() are optional: engines that cannot complete early or seek leave them out. */
type FinishablePlayer = Player & { finish?: () => void; seek?: (t: number) => void };

export interface ActionDeps {
  player: FinishablePlayer;
  /** Settings source of truth when the engine provides one. */
  settings?: () => Settings;
  soundLocked(): boolean;
  onUnlockSound(): void;
  close(): void;
  onRecord?: () => void;
  /** Surfaces a failure the player reported through a rejected promise. */
  reportError(error: unknown): void;
}

export interface Actions {
  /** Current settings: from the engine when available, otherwise what the toolbar last set. */
  settings(): Settings;
  /** Runs a command; returns false when it does not apply in the current phase. */
  run(command: Command): boolean;
}

export function createActions(deps: ActionDeps): Actions {
  const { player } = deps;
  const local: Settings = { ...DEFAULT_SETTINGS };
  /** Follow mode to restore when tour is switched off. */
  let followBeforeTour: FollowMode = "scroll";

  const settings = (): Settings => {
    if (!deps.settings) return local;
    const s = deps.settings();
    return {
      speed: Number.isFinite(s.speed) && s.speed > 0 ? s.speed : local.speed,
      sound: typeof s.sound === "boolean" ? s.sound : local.sound,
      follow: s.follow === "tour" || s.follow === "none" || s.follow === "scroll" ? s.follow : local.follow,
    };
  };

  const run = (command: Command): boolean => {
    const phase = phaseOf(player.state);
    if (!isAvailable(command.kind, phase)) return false;
    switch (command.kind) {
      case "close":
        deps.close();
        return true;
      case "togglePlay":
        // play() is called synchronously so the click still counts as the user gesture for audio.
        if (phase === "idle") startPlayback(player, deps.reportError);
        else if (phase === "running") player.pause();
        else player.resume();
        return true;
      case "toggleSound": {
        const current = settings();
        if (current.sound && (command.lockedAtPress || deps.soundLocked())) {
          // The first press while the browser blocks audio unlocks it instead of muting.
          deps.onUnlockSound();
          return true;
        }
        const next = !current.sound;
        player.setSound(next);
        local.sound = next;
        if (next && deps.soundLocked()) deps.onUnlockSound();
        return true;
      }
      case "toggleTour": {
        const current = settings().follow;
        if (current !== "tour") followBeforeTour = current;
        const next: FollowMode = current === "tour" ? followBeforeTour : "tour";
        player.setFollow(next);
        local.follow = next;
        return true;
      }
      case "speed": {
        if (!Number.isFinite(command.speed) || command.speed <= 0) return false;
        player.setSpeed(command.speed);
        local.speed = command.speed;
        return true;
      }
      case "replay":
        player.replay();
        return true;
      case "goLive":
        player.goLive();
        return true;
      case "finish":
        if (typeof player.finish !== "function") return false;
        player.finish();
        return true;
      case "seek":
        if (typeof player.seek !== "function" || !Number.isFinite(command.t) || command.t < 0) return false;
        player.seek(command.t);
        return true;
      case "record":
        if (!deps.onRecord) return false;
        deps.onRecord();
        return true;
    }
  };

  return { settings, run };
}

/** Calls play() and routes both a synchronous throw and a rejection to `report`. */
function startPlayback(player: Player, report: (error: unknown) => void): void {
  try {
    player.play().catch(report);
  } catch (error) {
    report(error);
  }
}
