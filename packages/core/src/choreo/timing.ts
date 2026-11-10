/**
 * Choreography timings and sizes.
 *
 * Every duration is in engine ms at speed 1; the engine applies the user's speed multiplier.
 * Ranges are `[min, max]` and are sampled with the agent's seeded rng, so cursors never move in
 * lockstep while the same seed still replays the same performance.
 */

import type { Rng } from "../types";

/** Closed interval `[min, max]`. */
export type Range = readonly [min: number, max: number];

/** Samples a range uniformly with a seeded rng. */
export function pick(rng: Rng, range: Range): number {
  return range[0] + (range[1] - range[0]) * rng();
}

/** Midpoint of a range (used by estimates, which must be deterministic without an rng). */
export function mid(range: Range): number {
  return (range[0] + range[1]) / 2;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/* ------------------------------------------------------------------ */
/* Pointer gestures                                                    */
/* ------------------------------------------------------------------ */

/** Button held before a drag starts moving: a deliberate grab (50-90 ms). */
export const PRESS_HOLD_MS: Range = [50, 90];
/** Button held during a single click; the release click follows by this much (45-75 ms). */
export const CLICK_HOLD_MS: Range = [45, 75];

/** Drags last `base + k * sqrt(distance)`, clamped to 200-650 ms: short drags stay readable, long ones never drag on. */
export const DRAG_BASE_MS = 110;
export const DRAG_PER_SQRT_PX_MS = 15;
export const DRAG_MIN_MS = 200;
export const DRAG_MAX_MS = 650;

export function dragDuration(distancePx: number): number {
  return clamp(DRAG_BASE_MS + DRAG_PER_SQRT_PX_MS * Math.sqrt(Math.max(0, distancePx)), DRAG_MIN_MS, DRAG_MAX_MS);
}

/** Stand-in for the engine's natural travel time in estimates (real travel runs ~150-600 ms). */
export const TRAVEL_ESTIMATE_MS = 380;
/** Tween step when the agent exposes no clock: about one 60 Hz frame. */
export const TWEEN_STEP_MS = 16;
/** Cursor targets stay this far inside the viewport so the operator never leaves the screen. */
export const VIEW_MARGIN_PX = 12;

/* ------------------------------------------------------------------ */
/* Box, image, media                                                   */
/* ------------------------------------------------------------------ */

/** Pause after the button is released before the fill starts, so the ghost reads as placed (70-130 ms). */
export const RELEASE_PAUSE_MS: Range = [70, 130];
/** Fill fading in over the gray placeholder (200-300 ms). */
export const BOX_FILL_MS: Range = [200, 300];
/** Corner radius and shadow arriving after the fill (140-200 ms). */
export const BOX_DETAIL_MS: Range = [140, 200];
/** Selection outline lingering on the finished box: the "full stop" of a placement (110-200 ms). */
export const BOX_HOLD_MS: Range = [110, 200];
/** Oversized boxes: the cursor drags the visible part, the rest completes by itself (360-500 ms). */
export const AUTOCOMPLETE_MS: Range = [360, 500];
/** Boxes smaller than this on both axes are clicked into place instead of dragged. */
export const MIN_DRAG_SIZE_PX = 6;

/** Image sweep (top to bottom) grows with height: 420-900 ms. */
export const IMAGE_SWEEP_BASE_MS = 360;
export const IMAGE_SWEEP_PER_PX_MS = 0.6;
export const IMAGE_SWEEP_MIN_MS = 420;
export const IMAGE_SWEEP_MAX_MS = 900;

export function sweepDuration(heightPx: number): number {
  return clamp(
    IMAGE_SWEEP_BASE_MS + IMAGE_SWEEP_PER_PX_MS * Math.max(0, heightPx),
    IMAGE_SWEEP_MIN_MS,
    IMAGE_SWEEP_MAX_MS,
  );
}

/** "paint" reveal: one brush row per ~90 px of height, 2-6 rows. */
export const PAINT_ROW_PX = 90;
export const PAINT_ROWS_MIN = 2;
export const PAINT_ROWS_MAX = 6;
/** "type" image reveal: pseudo characters of ~9 x 22 px, typed at this fraction of the text pace. */
export const IMAGE_TYPE_CHAR_W_PX = 9;
export const IMAGE_TYPE_LINE_H_PX = 22;
export const IMAGE_TYPE_SCALE = 0.6;
export const IMAGE_TYPE_MAX_UNITS = 900;
/** Frames an image task waits for its picture to load before revealing anyway (~0.75 s at 60 Hz). */
export const IMAGE_WAIT_FRAMES = 45;

/** Media placeholder fading in under its label (380-480 ms). */
export const MEDIA_FADE_MS: Range = [380, 480];
/** Media labels longer than this are shortened with an ellipsis. */
export const MEDIA_LABEL_MAX_CHARS = 40;
/** Generic fade (fallback task, "fade" reveals) (260-360 ms). */
export const FADE_MS: Range = [260, 360];
/** Reduced-motion cross-fade: no cursor, no overlays (roughly 150-250 ms). */
export const REDUCED_FADE_MS: Range = [150, 250];

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** Single-line text narrower than min(240 px, 25% of the viewport) is clicked, not dragged. */
export const TEXT_CLICK_MAX_WIDTH_PX = 240;
export const TEXT_CLICK_MAX_VIEW_SHARE = 0.25;
/** I-beam settling into the new text box (80-130 ms). */
export const IBEAM_NUDGE_MS: Range = [80, 130];
/** Breath before the first keystroke (70-150 ms) and after the last one (90-170 ms). */
export const TYPE_START_MS: Range = [70, 150];
export const TYPE_END_MS: Range = [90, 170];

/**
 * Typing budget: `max * (1 - exp(-n * key / max))` for n graphemes. Short labels type at ~29
 * graphemes/s (34 ms each, the middle of a 24-42 ms keystroke); long paragraphs compress smoothly
 * and never exceed 3.5 s, so a whole text task (open the box, type, grow or snap) stays within
 * ~4-6 s at 1x. Pauses are part of the budget, so they reshape the rhythm without lengthening it.
 */
export const TYPE_KEY_MS = 34;
export const TYPE_MAX_MS = 3500;
/** Strokes come no faster than this on average; long texts reveal a word or short phrase per stroke. */
export const MIN_STROKE_MS = 24;
/** Floor for any single gap between strokes (per-agent key rate limit). */
export const MIN_KEY_GAP_MS = 22;
/** Hard cap on strokes (and therefore key sounds) per text: ~44 ms chunks for a full-length paragraph. */
export const MAX_STROKES = 80;
/** At most this many key sounds when several strokes fall into one frame. */
export const MAX_SOUNDS_PER_BATCH = 2;
/** Per-stroke jitter (+-20%), word gap (+20-40%), beats after punctuation and line breaks. */
export const KEY_JITTER = 0.2;
export const WORD_GAP: Range = [1.2, 1.4];
export const PUNCTUATION_PAUSE_MS: Range = [40, 140];
export const NEWLINE_PAUSE_MS: Range = [60, 160];
/** Thinking pauses happen only at clause boundaries (after , . ; : ! ? and CJK equivalents). */
export const THINK_CHANCE = 0.06;
export const THINK_PAUSE_MS: Range = [120, 260];
/** Typing rhythm drifts between bursts and slower stretches within this factor band. */
export const RHYTHM_MIN = 0.75;
export const RHYTHM_MAX = 1.3;
export const RHYTHM_DRIFT = 0.22;
/** Caret and edit-frame geometry is re-measured at most this often (each read may force layout). */
export const CARET_REFRESH_MS = 70;
/** Caret height relative to the font size. */
export const CARET_HEIGHT_RATIO = 1.2;

/** Text at or above this size types small, then steps up to its size ("heading growth"). */
export const HEADING_MIN_PX = 28;
/** Headings by role grow from 1.6x the body size. */
export const BODY_FONT_PX = 16;
export const HEADING_ROLE_RATIO = 1.6;
/** Taller blocks (more lines, over a quarter viewport) or longer texts skip growth: it reads as noise. */
export const HEADING_MAX_LINES = 3.2;
export const HEADING_MAX_VIEW_SHARE = 0.25;
export const HEADING_MAX_GRAPHEMES = 120;
/** Draft size while typing: max(body size, 50-60% of the final size). */
export const HEADING_DRAFT_RATIO: Range = [0.5, 0.6];
/** Steps follow the document's own type scale (up to 4); otherwise a geometric ladder of ~1.25. */
export const HEADING_MAX_STEPS = 4;
export const HEADING_MIN_STEPS = 2;
export const HEADING_STEP_RATIO = 1.25;
/** Each step is held 45-80 ms with a rising tick while the cursor drags the resize handle. */
export const HEADING_STEP_MS: Range = [45, 80];

/** Text that snaps is typed off its guide: 18-48 px across the guide, 0-12 px along it. */
export const SNAP_ACROSS_PX: Range = [18, 48];
export const SNAP_ALONG_PX: Range = [0, 12];
/** The text jumps onto the guide once it is this close (magnet radius 6-10 px). */
export const SNAP_RADIUS_PX: Range = [6, 10];
/** Dragging onto the guide (240-360 ms); no overshoot. */
export const SNAP_DRAG_MS: Range = [240, 360];
/** Guide tightened after the snap (160-280 ms). */
export const SNAP_HOLD_MS: Range = [160, 280];

/* ------------------------------------------------------------------ */
/* Path                                                                */
/* ------------------------------------------------------------------ */

/** Paths with more anchors than this are traced continuously instead of clicked anchor by anchor. */
export const PEN_MAX_ANCHORS = 16;
/** Points the cursor visits while tracing a complex path. */
export const TRACE_SAMPLES = 10;
/** Pen click (40-60 ms). */
export const PEN_CLICK_MS: Range = [40, 60];
/** Pen moves between anchors: `60 + 7 * sqrt(d)`, 80-260 ms. */
export function penMoveDuration(distancePx: number): number {
  return clamp(60 + 7 * Math.sqrt(Math.max(0, distancePx)), 80, 260);
}
/** Stroke trace after the anchors: `220 + 0.45 ms/px`, 260-1100 ms. */
export function traceDuration(lengthPx: number): number {
  return clamp(220 + 0.45 * Math.max(0, lengthPx), 260, 1100);
}
/** Fill fading in after the strokes (220-320 ms). */
export const FILL_FADE_MS: Range = [220, 320];
/** Cursor lifting off the finished path (100-150 ms). */
export const PEN_LIFT_MS: Range = [100, 150];
/** Paths are parsed up to this many points; the rest still reveals with the final trace. */
export const MAX_PATH_POINTS = 5000;

/* ------------------------------------------------------------------ */
/* Guide                                                               */
/* ------------------------------------------------------------------ */

/** The cursor grabs the ruler this far inside the viewport edge (the ruler band is ~20 px). */
export const RULER_INSET_PX = 10;
/** Grab point along the ruler: 40-120 px away from the guide position. */
export const GUIDE_GRAB_SPREAD_PX: Range = [40, 120];
/** Hold on the ruler (80-140 ms), drag out (300-460 ms), admire the placed guide (160-240 ms). */
export const GUIDE_GRAB_MS: Range = [80, 140];
export const GUIDE_DRAG_MS: Range = [300, 460];
export const GUIDE_HOLD_MS: Range = [160, 240];

/* ------------------------------------------------------------------ */
/* Duplicate                                                           */
/* ------------------------------------------------------------------ */

/** Master selected (80-160 ms) and a beat before the alt-drag (60-120 ms). */
export const DUP_SELECT_HOLD_MS: Range = [80, 160];
export const DUP_BEAT_MS: Range = [60, 120];
/** Copy settling at its spot before edits (140-240 ms). */
export const DUP_SETTLE_MS: Range = [140, 240];
/** Text amend: double click (90-140 ms between clicks), select-all highlight (120-200 ms), quick retype. */
export const DUP_DOUBLE_CLICK_GAP_MS: Range = [90, 140];
export const DUP_HIGHLIGHT_MS: Range = [120, 200];
export const DUP_RETYPE_SCALE = 0.75;
export const DUP_RETYPE_MAX_MS = 1600;
/** Image swap wipe (150-260 ms) and restyle beat (120-200 ms). */
export const DUP_SWAP_MS: Range = [150, 260];
export const DUP_RESTYLE_MS: Range = [120, 200];
/** Opacity of the copy while it is being dragged. */
export const DUP_DRAG_OPACITY = 0.82;

/* ------------------------------------------------------------------ */
/* Estimates                                                           */
/* ------------------------------------------------------------------ */

/** Estimated chance that a duplicate needs an edit after the drop. */
export const DUP_EDIT_LIKELIHOOD = 0.5;
/** Typical alt-drag distance used when the master is unknown to the estimator. */
export const DUP_DRAG_ESTIMATE_PX = 260;
/** Bounds of any estimate. */
export const MIN_ESTIMATE_MS = 150;
export const MAX_ESTIMATE_MS = 8000;
