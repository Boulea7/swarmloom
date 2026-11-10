/**
 * Placement notes (box, image, media, duplicate).
 *
 * Sound semantics (src/internal.ts): `note.pitch` is `1 - normalizedArea`, so small elements
 * sound high and large ones low; the sound zone maps it onto its scale and quantizes the time.
 */

import type { Rect } from "../types";
import { area, center, distanceToRect } from "./geometry";
import type { TaskScope } from "./scope";
import { clamp } from "./timing";

/** Areas at or below this share of the viewport normalize to 0 (highest note). */
export const AREA_FLOOR = 0.001;
/** Default velocity of a placement note. */
export const NOTE_VEL = 0.62;
/** Off-screen placements fade to this share of their velocity, half a viewport away. */
const OFFSCREEN_VEL_FLOOR = 0.45;

/**
 * Log-scaled area of `box` relative to the viewport, 0..1: 0.1% of the viewport or less is 0,
 * the full viewport (or more) is 1. The log keeps typical UI sizes (0.2%-8%) spread across the range.
 */
export function normalizedArea(box: Rect, view: Rect): number {
  const viewArea = Math.max(1, view.w * view.h);
  const share = area(box) / viewArea;
  if (!(share > AREA_FLOOR)) return 0;
  return clamp(Math.log(share / AREA_FLOOR) / Math.log(1 / AREA_FLOOR), 0, 1);
}

/** `note` pitch for a placement: `1 - normalizedArea`. */
export function placementPitch(box: Rect, view: Rect): number {
  return 1 - normalizedArea(box, view);
}

/** Velocity that eases off smoothly for placements outside the viewport. */
export function placementVelocity(box: Rect, view: Rect, base = NOTE_VEL): number {
  const away = distanceToRect(center(box), view);
  const falloff = clamp(away / Math.max(1, view.h * 0.5), 0, 1);
  return clamp(base * (1 - (1 - OFFSCREEN_VEL_FLOOR) * falloff), 0, 1);
}

export interface NoteOptions {
  /** Velocity before off-screen falloff. */
  vel?: number;
  /** Added to the pitch (positive = higher, i.e. towards "smaller"), clamped to 0..1. */
  shift?: number;
}

/** Emits one placement note for `box`. */
export function playPlacementNote(scope: TaskScope, box: Rect, opts: NoteOptions = {}): void {
  const view = scope.viewport();
  const pitch = clamp(placementPitch(box, view) + (opts.shift ?? 0), 0, 1);
  scope.sound("note", { pitch, vel: placementVelocity(box, view, opts.vel ?? NOTE_VEL) });
}
