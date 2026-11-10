/**
 * Engine tunables. Times are milliseconds, distances CSS px, speeds px per second.
 *
 * "Player time" advances with the clock while the player runs (never scaled by speed): intro,
 * finale, sound timestamps and scrolling use it. "Task time" advances by `dt * speed` while
 * building: every wait a choreography yields is measured in it.
 */

/* Frame and physics ------------------------------------------------------------------------ */

/** Longest slice integrated at once; longer clock deltas (coarse export frames) are split. */
export const MAX_TICK_MS = 100;
/** Fixed step of free (non-task) motion, so steering behaves the same at any frame rate. */
export const PHYSICS_STEP_MS = 1000 / 120;
/**
 * Physics sub-steps per slice at most (MAX_TICK_MS at up to about 4x speed); beyond that the
 * free motion of the slice is shortened rather than stalling the frame.
 */
export const MAX_PHYSICS_STEPS = 48;

/* Agents ----------------------------------------------------------------------------------- */

export const AUTO_MIN_AGENTS = 8;
export const AUTO_MAX_AGENTS = 64;
/** Hard cap for an explicit agent count. */
export const MAX_AGENTS = 128;
/** Share of the pool that is active from the start; the rest joins on demand. */
export const BASE_SHARE = 0.5;
/** Reference viewport area for the auto count (a common laptop viewport). */
export const REFERENCE_AREA = 1280 * 800;

/* Task driving ----------------------------------------------------------------------------- */

/** Generator resumptions per agent per frame while catching up on short waits. */
export const MAX_STEPS_PER_FRAME = 512;
/** A task running longer than max(estimate * factor, minimum) is aborted and its layer finished. */
export const TASK_TIMEOUT_FACTOR = 8;
export const TASK_TIMEOUT_MIN_MS = 20_000;
/** Used when a choreography estimate is missing or invalid. */
export const DEFAULT_ESTIMATE_MS = 800;
/** Duration of the built-in fallback fade task. */
export const FALLBACK_FADE_MS = 260;
/** Error events emitted per run at most (protects listeners from floods). */
export const MAX_ERROR_EVENTS = 50;
/** Sound log cap (about 50 minutes of dense typing). */
export const MAX_SOUND_LOG = 250_000;

/* Motion ----------------------------------------------------------------------------------- */

/** Travel time: base + k * sqrt(distance), clamped; multiplied by the agent's pace. */
export const MOVE_BASE_MS = 90;
export const MOVE_PER_SQRT_PX = 20;
export const MOVE_MIN_MS = 110;
export const MOVE_MAX_MS = 650;
export const DRAG_BASE_MS = 140;
export const DRAG_PER_SQRT_PX = 24;
export const DRAG_MIN_MS = 160;
export const DRAG_MAX_MS = 900;
/** Sideways bend of a move, as a share of its length (drags stay straight). */
export const BEND_SHARE = 0.12;
export const MAX_BEND_PX = 48;
/** Tiny overshoot past the target near the end of a default-eased move. */
export const OVERSHOOT_SHARE = 0.02;
export const MAX_OVERSHOOT_PX = 5;
/** Moves shorter than this with no explicit duration snap in place. */
export const SNAP_DISTANCE_PX = 0.5;

/* Intro ------------------------------------------------------------------------------------ */

/** Intro length: MIN + rng * SPAN (1.5 to 2.5 s). */
export const INTRO_MIN_MS = 1500;
export const INTRO_SPAN_MS = 1000;
export const ICON_SIZE = 56;
export const ICON_FADE_IN_MS = 320;
export const ICON_FADE_OUT_MS = 320;

/* Follow, unlock, crew --------------------------------------------------------------------- */

/** Work below the fold that unlocks early, as a share of the viewport height. */
export const LOOKAHEAD_SHARE = 0.5;
/** Scroll mode: with nothing to do for this long, unlock one more viewport below. */
export const IDLE_EXPAND_MS = 1200;
/** Minimum gap between two agents joining. */
export const JOIN_COOLDOWN_MS = 70;
/** Extra (non-base) agents idle this long leave the screen. */
export const RETIRE_IDLE_MS = 2500;
/** Smoothing of the user scroll speed estimate. */
export const SCROLL_SMOOTH_MS = 300;
/** Each this many px/s of user scroll speed calls one more agent. */
export const SCROLL_PX_PER_AGENT = 220;
/** Rulers stay up this long after the last guide-related task. */
export const RULER_GRACE_MS = 1500;

/* Tour ------------------------------------------------------------------------------------- */

/** The earliest unfinished layer is kept this far (share of viewport) below the top edge. */
export const TOUR_LEAD_SHARE = 0.3;
/** Proportional gain toward the target scroll position, per second. */
export const TOUR_GAIN = 1.4;
/** Scroll speed cap at 1x (scaled with speed up to 3x). */
export const TOUR_MAX_PX_S = 300;
export const TOUR_SMOOTH_MS = 250;
/** A user scroll suspends the tour for this long. */
export const TOUR_HOLD_MS = 1600;

/* Finale and go-live ----------------------------------------------------------------------- */

/** Time in the "finale" state before "done" (the motion continues). */
export const FINALE_SETTLE_MS = 1200;
/** Finale "none": cursors fade out over this long. */
export const NONE_FADE_MS = 600;
/** Go live: cursors leave this long before the stage fades out. */
export const EXIT_MS = 450;
/** Alpha change rate for entering / leaving agents, per second. */
export const ALPHA_RATE = 5;

/* Reduced motion --------------------------------------------------------------------------- */

export const REDUCED_FADE_MS = 220;
/** Whole cross-fade budget; the stagger shrinks for big blueprints. */
export const REDUCED_TOTAL_MS = 3000;
export const REDUCED_MAX_STAGGER_MS = 40;
