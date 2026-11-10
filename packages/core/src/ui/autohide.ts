/**
 * Toolbar auto-hide: while the build runs, the toolbar fades out after a quiet period with no
 * pointer activity and comes back on activity. Pins (finished build, keyboard focus, hover,
 * sound hint) keep it shown. A tap on the empty stage toggles it on touch screens.
 *
 * Wall-clock UI behaviour only; it never feeds the engine, so it does not affect exports.
 */

export interface AutoHideDeps {
  delayMs: number;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Called whenever the shown state changes. */
  apply(shown: boolean): void;
}

export type PinReason = "phase" | "focus" | "hover";

export interface AutoHide {
  readonly shown: boolean;
  pin(reason: PinReason, on: boolean): void;
  /** Pointer moved / pressed / wheeled: show and restart the quiet period. */
  activity(): void;
  /** Tap on the empty stage (touch): hide when shown, otherwise show. Ignored while pinned. */
  toggle(): void;
  destroy(): void;
}

export function createAutoHide(deps: AutoHideDeps): AutoHide {
  const pins = new Set<PinReason>();
  let shown = true;
  let lastActivity = deps.now();
  let timer: unknown = null;
  let destroyed = false;

  const set = (next: boolean): void => {
    if (next === shown) return;
    shown = next;
    deps.apply(next);
  };

  const disarm = (): void => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };

  /** One timer per quiet period; activity only moves `lastActivity`, so pointermove does not churn timers. */
  const arm = (ms: number): void => {
    if (timer !== null || destroyed) return;
    timer = deps.setTimer(() => {
      timer = null;
      if (pins.size > 0 || destroyed) return;
      const quiet = deps.now() - lastActivity;
      if (quiet >= deps.delayMs) set(false);
      else arm(deps.delayMs - quiet);
    }, ms);
  };

  return {
    get shown() {
      return shown;
    },
    pin(reason, on) {
      if (on === pins.has(reason)) return;
      if (on) {
        pins.add(reason);
        disarm();
        set(true);
      } else {
        pins.delete(reason);
        if (pins.size === 0) {
          lastActivity = deps.now();
          arm(deps.delayMs);
        }
      }
    },
    activity() {
      lastActivity = deps.now();
      set(true);
      if (pins.size === 0) arm(deps.delayMs);
    },
    toggle() {
      if (pins.size > 0) return;
      if (shown) {
        disarm();
        set(false);
      } else {
        lastActivity = deps.now();
        set(true);
        arm(deps.delayMs);
      }
    },
    destroy() {
      destroyed = true;
      disarm();
    },
  };
}
