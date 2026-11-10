/**
 * Built-in choreographies (box, text, path, image, media, guide, duplicate) as a plugin, plus
 * pure helpers for the planner. See src/internal.ts "choreo" for the seam.
 *
 * Every task drives one cursor through AgentApi and changes the scene only through StageApi.
 * Timings are engine ms at speed 1 (see ./timing). Each task ends with `stage.finish(layer.id)`
 * and leaves no overlay, held button, cursor shape or transient style behind, whether it
 * completes, fails or is aborted.
 */

import type { ChoreoHelpers } from "../internal";
import type { Layer, Plugin, TaskFn } from "../types";
import { estimate } from "./estimate";
import { defineTask, type TaskBody } from "./scope";
import { boxTask } from "./tasks/box";
import { createDuplicateTask } from "./tasks/duplicate";
import { fadeTask, reducedTask } from "./tasks/fade";
import { guideTask } from "./tasks/guide";
import { imageTask } from "./tasks/image";
import { mediaTask } from "./tasks/media";
import { pathTask } from "./tasks/path";
import { textTask } from "./tasks/text";

/** Regular choreography of a layer's kind; also what a duplicate falls back to without a master. */
const byKind: TaskBody<Layer> = (scope, layer) => {
  switch (layer.kind) {
    case "box":
      return boxTask(scope, layer);
    case "text":
      return textTask(scope, layer);
    case "path":
      return pathTask(scope, layer);
    case "image":
      return imageTask(scope, layer);
    case "media":
      return mediaTask(scope, layer);
    case "guide":
      return guideTask(scope, layer);
    default:
      return fadeTask(scope, layer);
  }
};

/** Task keys registered by {@link builtinPlugin}. */
export const BUILTIN_TASKS = [
  "box",
  "text",
  "path",
  "image",
  "media",
  "guide",
  "duplicate",
  "fade",
  "reduced",
] as const;
export type BuiltinTaskName = (typeof BUILTIN_TASKS)[number];

const tasks: Record<BuiltinTaskName, TaskFn<Layer>> = {
  box: defineTask(byKind),
  text: defineTask(byKind),
  path: defineTask(byKind),
  image: defineTask(byKind),
  media: defineTask(byKind),
  guide: defineTask(byKind),
  duplicate: defineTask(createDuplicateTask(byKind)),
  fade: defineTask(fadeTask),
  reduced: defineTask(reducedTask),
};

/**
 * The built-in choreographies. Task keys: "box" | "text" | "path" | "image" | "media" | "guide"
 * | "duplicate" (any layer with `master`), plus "fade", a generic click-and-fade the engine may
 * use as its fallback for layers no plugin handles, and "reduced", a cursor-less cross-fade for
 * reduced motion.
 *
 * The kind tasks dispatch on `layer.kind`, so a layer handed to the wrong key still gets the
 * right choreography.
 */
export const builtinPlugin: Plugin = Object.freeze({
  name: "swarmloom:builtin",
  tasks: Object.freeze({ ...tasks }),
});

/** Pure helpers for the planner. */
export const choreoHelpers: ChoreoHelpers = Object.freeze({ estimate });
