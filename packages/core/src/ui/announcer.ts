/**
 * Screen-reader milestones for the polite live region: build start, halfway, done.
 * Each milestone is announced once per run; a replay (progress drops or the build restarts after
 * finishing) re-arms them. Announcing only milestones keeps the region from chattering.
 */

import type { Phase } from "./view-model";

export type Milestone = { kind: "start"; total: number } | { kind: "half" } | { kind: "done" };

export interface MilestoneTracker {
  /** Feed the latest state; returns the milestone to announce now, if any. */
  update(phase: Phase, built: number, total: number): Milestone | null;
}

export function createMilestones(): MilestoneTracker {
  let started = false;
  let half = false;
  let done = false;
  let lastBuilt = 0;

  return {
    update(phase, built, total) {
      const restarted = (done && (phase === "running" || phase === "idle")) || built < lastBuilt;
      if (restarted) {
        started = false;
        half = false;
        done = false;
      }
      lastBuilt = built;

      if (phase === "done") {
        if (done) return null;
        done = true;
        started = true;
        half = true;
        return { kind: "done" };
      }
      if (phase !== "running" && phase !== "paused") return null;
      if (!started && total > 0) {
        started = true;
        return { kind: "start", total };
      }
      if (started && !half && total > 0 && built * 2 >= total) {
        half = true;
        return { kind: "half" };
      }
      return null;
    },
  };
}
