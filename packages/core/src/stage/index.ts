import type { CreateStageFn, Stage } from "../internal";
import type { MountStats } from "./mounter";
import { SwarmStage } from "./stage";

export type { MountStats } from "./mounter";

/**
 * Creates the stage for one blueprint: an isolated closed shadow tree over the page (overlay, in
 * the top layer when supported) or inside a container (inline). Throws a TypeError for invalid
 * options; individual malformed layers degrade to nothing instead.
 */
export const createStage: CreateStageFn = (opts) => new SwarmStage(opts);

/** Virtualization counters of a stage made by {@link createStage} (tests, diagnostics); null otherwise. */
export function stageStats(stage: Stage): MountStats | null {
  return stage instanceof SwarmStage ? stage.stats : null;
}
