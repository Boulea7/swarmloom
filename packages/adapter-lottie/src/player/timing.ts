/** How a Lottie animation is played after the weave. Frames are composition frames. */
export interface PlaybackTiming {
  /** In point (`ip`). */
  ip: number;
  /** Out point (`op`). */
  op: number;
  /** Frames per second (`fr`). */
  fr: number;
  /** Playback speed multiplier (> 0). */
  speed: number;
  /** true loops forever, false plays once, n plays n times; then the last frame holds. */
  loop: boolean | number;
}

/** Frames in one cycle, as lottie-web counts them (`floor(op - ip)`, at least 1). */
export function frameCount(t: PlaybackTiming): number {
  return Math.max(1, Math.floor(t.op - t.ip));
}

/** Length of one cycle at speed 1, ms. */
export function cycleMs(t: PlaybackTiming): number {
  return (frameCount(t) * 1000) / t.fr;
}

/** Frame index (0-based from the in point) nearest to `ms` within one cycle. */
export function indexAtTime(ms: number, t: PlaybackTiming): number {
  const n = frameCount(t);
  const i = Math.round(((Number.isFinite(ms) ? ms : 0) * t.fr) / 1000);
  return Math.min(n - 1, Math.max(0, i));
}

/** Time of a frame index within one cycle, ms. */
export function timeOfIndex(index: number, t: PlaybackTiming): number {
  return (index * 1000) / t.fr;
}

/**
 * Frame index shown `elapsed` engine ms after playback started at `from` ms of the cycle.
 *
 * A pure function of engine time: whole source frames (`fr`), so the same transport time always
 * shows the same frame whatever the render rate, and exports match realtime playback.
 */
export function indexAt(elapsed: number, t: PlaybackTiming, from = 0): number {
  const n = frameCount(t);
  const ms = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0) * t.speed + Math.max(0, from);
  // The epsilon absorbs float noise of accumulated clock steps landing exactly on a frame edge.
  const k = Math.floor((ms * t.fr) / 1000 + 1e-6);
  if (t.loop === true) return k % n;
  const plays = t.loop === false ? 1 : Math.max(1, Math.floor(t.loop));
  return k >= n * plays ? n - 1 : k % n;
}
