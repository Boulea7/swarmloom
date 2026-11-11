import type { Point, Rect, StageApi } from "../types";
import { type Agent, BENCHED, EXITING, FADING, SWARM } from "./agent";
import { Flock } from "./flock";
import { HaloFormation, type HaloLevels } from "./halo";
import type { FinaleMode } from "./options";
import type { Roster } from "./roster";

/**
 * End-of-build motion. "flock": boids around the pointer (or a drifting point); "halo": rings
 * around the viewport centre driven by sound levels; "none": cursors fade out in place.
 * Modes can be switched at any time during the finale; the crew is topped up to the finale
 * size from the side edges.
 */
export class Finale {
  #mode: FinaleMode | null = null;
  readonly #flock = new Flock();
  readonly #halo = new HaloFormation();
  readonly #target: Point = { x: 0, y: 0 };
  #size = 0;
  #nextSlot = 0;

  /** Current mode, or null before the finale starts. */
  get mode(): FinaleMode | null {
    return this.#mode;
  }

  /**
   * Starts the finale or switches it to another mode.
   * @param size Crew size to reach (halo slots are laid out for at least this many).
   * @param colors Agent colours for the halo overlay.
   */
  begin(mode: FinaleMode, roster: Roster, stage: StageApi, colors: readonly string[], size: number, pt: number): void {
    this.end(roster);
    this.#mode = mode;
    const visible = roster.agents.filter((a) => a.mode !== BENCHED && a.mode !== EXITING);
    this.#size = Math.max(size, visible.length);
    if (mode === "none") {
      for (const a of visible) {
        a.mode = FADING;
        a.showHeading = false;
        a.resetPose();
      }
      return;
    }
    if (mode === "halo") this.#halo.begin(stage, this.#size, colors, pt);
    for (const a of visible) this.#enlist(a);
  }

  /** Per-frame work: tops up the crew and refreshes the halo overlay. */
  frame(roster: Roster, vp: Rect, pt: number, levels: HaloLevels | null): void {
    if (this.#mode === null || this.#mode === "none") return;
    if (roster.activeCount() < this.#size) {
      const joined = roster.join(SWARM, vp, pt);
      if (joined) this.#enlist(joined);
    }
    if (this.#mode === "halo") this.#halo.frame(vp, pt, levels);
  }

  /** One physics step of `h` seconds for the swarm. */
  step(agents: readonly Agent[], vp: Rect, pointer: Point | null, pt: number, h: number): void {
    if (this.#mode === "flock") {
      const target = this.#flock.target(pointer, vp, pt, this.#target);
      this.#flock.step(agents, target, pointer !== null, pt, h);
      return;
    }
    if (this.#mode !== "halo") return;
    for (const a of agents) {
      if (a.mode !== SWARM || a.slot < 0) continue;
      this.#halo.steer(a, a.slot, vp, pt, h);
      a.scale = this.#halo.scaleFor(a.slot);
    }
  }

  /** Leaves the finale: removes the halo overlay, resets slots and scales. */
  end(roster: Roster): void {
    this.#halo.end();
    this.#mode = null;
    this.#nextSlot = 0;
    for (const a of roster.agents) {
      a.slot = -1;
      a.scale = 1;
    }
  }

  #enlist(a: Agent): void {
    a.mode = SWARM;
    a.showHeading = true;
    a.resetPose();
    a.slot = this.#mode === "halo" && this.#nextSlot < this.#size ? this.#nextSlot++ : -1;
  }
}
