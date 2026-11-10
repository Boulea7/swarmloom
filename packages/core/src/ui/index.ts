/**
 * Built-in toolbar: a floating pill at the bottom centre of the stage with progress ring (ETA
 * tooltip), play/pause, speed 1x/2x/3x, sound (with a "Tap for sound" hint while the browser
 * blocks audio), tour, replay, go live (primary once done), optional record, and close.
 *
 * Behaviour: keyboard shortcuts (see ./keyboard), arrow-key navigation inside the toolbar,
 * auto-hide after ~2.5 s without pointer activity while building, tap on the empty stage toggles
 * it on touch screens, icons-only compact layout with 44 px targets on narrow hosts, safe-area
 * insets, fold-aware placement on dual-segment screens and a polite live region announcing
 * start / halfway / done.
 */

import type { Controls, ControlsOptions, I18n } from "../internal";
import type { Player } from "../types";
import { type Actions, createActions } from "./actions";
import { createMilestones, type Milestone } from "./announcer";
import { createAutoHide } from "./autohide";
import { setAttr, setHidden, setStyleVar, setText } from "./dom";
import { bindShortcuts, type KeyboardScope } from "./keyboard";
import { type DockPlacement, placeDock, readSegments } from "./placement";
import { buildToolbar, focusableItems, renderToolbar, type ToolbarText } from "./toolbar";
import { buildView, type Command, SPEEDS, type ToolbarView, translator } from "./view-model";

export { commandForKey, type KeyboardScope, type KeyInput } from "./keyboard";
export { ELEMENT_NAME } from "./toolbar";
export { isAvailable, phaseOf } from "./view-model";

/** Host width (CSS px) below which the toolbar switches to the icons-only compact layout. */
export const COMPACT_BELOW = 560;

/** Default quiet period before the toolbar hides while building. */
export const AUTO_HIDE_MS = 2500;

/** Progress-driven re-renders are coalesced to at most this often (ms). */
const PROGRESS_INTERVAL_MS = 200;

/** Heartbeat for values without change events: ETA, sound lock, fold focus. */
const HEARTBEAT_MS = 1000;

/** A touch counts as a tap when it ends this fast and this close to where it started. */
const TAP_MAX_MS = 350;
const TAP_MAX_PX = 12;

/** Options beyond the internal seam, for shells that embed the toolbar directly. */
export interface ToolbarOptions extends ControlsOptions {
  /**
   * Which key presses reach the shortcuts. "auto" (default): when the player covers the viewport or
   * the user last clicked/focused inside it. "window": always. "host": only after interacting with it.
   */
  keyboard?: KeyboardScope;
  /** Quiet period before auto-hide while building, ms (default {@link AUTO_HIDE_MS}). */
  autoHideMs?: number;
}

/**
 * Mounts the toolbar into `opts.host` (normally Stage.uiLayer) and wires it to the player.
 *
 * @throws TypeError when `host`, `player`, `i18n` or the sound callbacks are missing or malformed.
 */
export function createControls(opts: ToolbarOptions): Controls {
  validate(opts);
  const { host, player, i18n } = opts;
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new TypeError("createControls() needs a host attached to a document with a window");

  const dom = buildToolbar(doc, opts.chrome === "dark" ? "dark" : "light");
  const text = toolbarText(i18n);
  const t = translator(i18n);
  const milestones = createMilestones();
  const cleanups: Array<() => void> = [];
  const listen = <E extends Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    options?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, fn as EventListener, options);
    cleanups.push(() => target.removeEventListener(type, fn as EventListener, options));
  };

  let destroyed = false;
  let forcedHidden = false;
  let compact = false;
  let placement: DockPlacement | null = null;
  let view: ToolbarView | null = null;
  let layoutKey = "";
  let focusWithin = false;
  let activeItem: HTMLElement | null = null;
  let progress = { built: 0, total: 0 };

  const actions: Actions = createActions({
    player,
    settings: opts.settings,
    soundLocked: () => safe(() => opts.soundLocked(), false),
    onUnlockSound: () => opts.onUnlockSound(),
    close: () => (opts.onClose ? opts.onClose() : player.destroy()),
    onRecord: opts.onRecord,
    reportError: (error) => reportFailure(win, error),
  });

  const autoHide = createAutoHide({
    delayMs: validDelay(opts.autoHideMs),
    now: () => win.performance.now(),
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    clearTimer: (handle) => win.clearTimeout(handle as number),
    apply: (shown) => setAttr(dom.dock, "data-away", !shown),
  });

  /* ---------------------------------------------------------------- render */

  const makeView = (compactLayout: boolean): ToolbarView => {
    const live = safe(() => player.progress, progress);
    progress = { built: live.built, total: live.total };
    return buildView(
      {
        state: player.state,
        built: progress.built,
        total: progress.total,
        etaMs: safe(() => player.eta(), Number.NaN),
        settings: actions.settings(),
        soundLocked: safe(() => opts.soundLocked(), false),
        compact: compactLayout,
        canRecord: typeof opts.onRecord === "function",
      },
      t,
    );
  };

  const render = (): void => {
    if (destroyed) return;
    view = makeView(compact);
    renderToolbar(dom, view, text, compact);
    syncRoving();
    autoHide.pin("phase", view.pinned);
    announce(milestones.update(view.phase, progress.built, progress.total));
    const key = layoutSignature(view);
    if (key !== layoutKey) {
      layoutKey = key;
      scheduleLayout();
    }
  };

  const announce = (m: Milestone | null): void => {
    if (!m) return;
    const message =
      m.kind === "start"
        ? t("announce.start", { count: m.total })
        : m.kind === "half"
          ? t("announce.half")
          : t("announce.done");
    setText(dom.live, message);
  };

  let frame = 0;
  let throttle: number | null = null;
  let lastRender = Number.NEGATIVE_INFINITY;

  /** Renders on the next animation frame (state changes, heartbeat). */
  const schedule = (): void => {
    if (frame || destroyed) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      lastRender = win.performance.now();
      render();
    });
  };

  /** Renders at most every PROGRESS_INTERVAL_MS (progress events can arrive every frame). */
  const scheduleProgress = (): void => {
    if (throttle !== null || frame) return;
    const wait = PROGRESS_INTERVAL_MS - (win.performance.now() - lastRender);
    if (wait <= 0) {
      schedule();
      return;
    }
    throttle = win.setTimeout(() => {
      throttle = null;
      schedule();
    }, wait);
  };

  /* ---------------------------------------------------------------- layout */

  let layoutFrame = 0;
  const scheduleLayout = (): void => {
    if (layoutFrame || destroyed) return;
    layoutFrame = win.requestAnimationFrame(() => {
      layoutFrame = 0;
      relayout();
    });
  };

  /** Placement (fold) first, then compact vs full against the space actually available. */
  const relayout = (): void => {
    if (destroyed) return;
    const rect = dom.element.getBoundingClientRect();
    updatePlacement(rect);
    const width = placement ? placement.width : rect.width;
    let next = width > 0 && width < COMPACT_BELOW;
    if (!next && width > 0) {
      // Long labels (e.g. es/fr) can overflow the full layout even on wide hosts: lay it out and see
      // whether the bar had to wrap (tooltips overflow on purpose, so scrollWidth is no signal).
      renderToolbar(dom, makeView(false), text, false);
      next = wraps(focusableItems(dom));
    }
    compact = next;
    render();
  };

  const updatePlacement = (rect: DOMRect): void => {
    const segments = readSegments(win);
    const focus = segments ? safe(() => opts.focus?.() ?? null, null) : null;
    const next = placeDock(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      segments,
      focus,
      placement?.segment ?? null,
    );
    placement = next;
    setStyleVar(dom.dock, "--sl-dock-left", next ? `${next.left}px` : null);
    setStyleVar(dom.dock, "--sl-dock-width", next ? `${next.width}px` : null);
    setStyleVar(dom.dock, "--sl-dock-bottom", next ? `${next.bottom}px` : null);
  };

  /* ------------------------------------------------------------- commands */

  const dispatch = (command: Command): boolean => {
    if (destroyed) return false;
    const done = actions.run(command);
    if (done && !destroyed) {
      autoHide.activity();
      render();
    }
    return done;
  };

  const commandFromButton = (el: Element): Command | null => {
    const cmd = el.getAttribute("data-cmd");
    if (!cmd) return null;
    if (cmd === "speedCycle") {
      const index = (SPEEDS as readonly number[]).indexOf(actions.settings().speed);
      return { kind: "speed", speed: SPEEDS[(index + 1) % SPEEDS.length] ?? 1 };
    }
    if (cmd.startsWith("speed:")) return { kind: "speed", speed: Number(cmd.slice(6)) };
    return isCommandKind(cmd) ? { kind: cmd } : null;
  };

  listen<MouseEvent>(dom.bar, "click", (e) => {
    const target = (e.target as Element | null)?.closest?.("[data-cmd]");
    if (!target || !dom.bar.contains(target)) return;
    const command = commandFromButton(target);
    if (command) dispatch(command);
  });

  /* ------------------------------------------------------ roving tab focus */

  const allItems: readonly HTMLElement[] = [
    dom.ring.el,
    dom.play.el,
    ...dom.speedRadios,
    dom.speedCycle.el,
    dom.sound.el,
    dom.tour.el,
    dom.replay.el,
    dom.goLive.el,
    dom.record.el,
    dom.close.el,
  ];

  /** One tab stop for the whole toolbar; arrows move between items (WAI-ARIA toolbar pattern). */
  const syncRoving = (): void => {
    const items = focusableItems(dom);
    const hadFocus = activeItem !== null && dom.root.activeElement === activeItem;
    if (!activeItem || !items.includes(activeItem)) {
      activeItem = items.find((el) => el !== dom.ring.el) ?? items[0] ?? null;
      if (hadFocus || (focusWithin && !items.includes(dom.root.activeElement as HTMLElement))) activeItem?.focus();
    }
    for (const el of allItems) setAttr(el, "tabindex", el === activeItem ? 0 : -1);
  };

  listen<KeyboardEvent>(dom.bar, "keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const items = focusableItems(dom);
    if (items.length === 0) return;
    const current = items.indexOf(dom.root.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % items.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    const target = items[next];
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    activeItem = target;
    syncRoving();
    target.focus();
  });

  listen<FocusEvent>(dom.root, "focusin", (e) => {
    focusWithin = true;
    const target = e.target as HTMLElement | null;
    if (target && target !== activeItem && allItems.includes(target)) {
      activeItem = target;
      syncRoving();
    }
    autoHide.pin("focus", matchesFocusVisible(target));
  });
  listen<FocusEvent>(dom.root, "focusout", (e) => {
    const next = e.relatedTarget as Node | null;
    if (next && dom.root.contains(next)) return;
    focusWithin = false;
    autoHide.pin("focus", false);
  });

  /* ------------------------------------------------- pointer and auto-hide */

  listen<PointerEvent>(dom.bar, "pointerenter", (e) => {
    if (e.pointerType === "mouse") autoHide.pin("hover", true);
  });
  listen<PointerEvent>(dom.bar, "pointerleave", () => autoHide.pin("hover", false));

  const surface = host.getRootNode() as Document | ShadowRoot;
  const scope = isShadowRoot(surface) ? surface.host : host;
  let tap: { id: number; x: number; y: number; t: number } | null = null;
  const onToolbar = (e: Event): boolean => e.composedPath().includes(dom.bar);

  listen<PointerEvent>(
    surface,
    "pointermove",
    (e) => {
      if (e.pointerType !== "touch" && !forcedHidden) autoHide.activity();
    },
    { passive: true },
  );
  listen<WheelEvent>(
    surface,
    "wheel",
    () => {
      if (!forcedHidden) autoHide.activity();
    },
    { passive: true },
  );
  listen<PointerEvent>(
    surface,
    "pointerdown",
    (e) => {
      if (forcedHidden) return;
      if (e.pointerType === "touch") {
        tap = e.isPrimary && !onToolbar(e) ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
      } else {
        autoHide.activity();
      }
    },
    { passive: true },
  );
  listen<PointerEvent>(
    surface,
    "pointerup",
    (e) => {
      const start = tap;
      tap = null;
      if (!start || e.pointerId !== start.id || forcedHidden) return;
      const quick = e.timeStamp - start.t <= TAP_MAX_MS;
      const still = Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_MAX_PX;
      if (quick && still) autoHide.toggle();
    },
    { passive: true },
  );
  listen(surface, "pointercancel", () => {
    tap = null;
  });

  /* ------------------------------------------------------- resize and fold */

  listen(win, "resize", scheduleLayout, { passive: true });
  const posture = (win.navigator as Navigator & { devicePosture?: EventTarget }).devicePosture;
  if (posture && typeof posture.addEventListener === "function") listen(posture, "change", scheduleLayout);
  if (typeof win.ResizeObserver === "function") {
    const observer = new win.ResizeObserver(() => scheduleLayout());
    observer.observe(dom.element);
    cleanups.push(() => observer.disconnect());
  }

  /* ----------------------------------------------------- player and timers */

  const offState = player.on("state", (e) => {
    if (e.state === "destroyed") controls.destroy();
    else schedule();
  });
  const offProgress = player.on("progress", (e) => {
    progress = { built: e.built, total: e.total };
    scheduleProgress();
  });
  cleanups.push(offState, offProgress);

  const heartbeat = win.setInterval(() => {
    schedule();
    if (placement || readSegments(win)) scheduleLayout();
  }, HEARTBEAT_MS);

  cleanups.push(
    bindShortcuts({
      win,
      scope,
      mode: opts.keyboard ?? "auto",
      focusInToolbar: () => focusWithin,
      dispatch,
    }),
  );

  /* ------------------------------------------------------------- lifecycle */

  const controls: Controls = {
    setVisible(visible) {
      if (destroyed) return;
      forcedHidden = !visible;
      setHidden(dom.dock, forcedHidden);
      if (visible) autoHide.activity();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.clearInterval(heartbeat);
      if (frame) win.cancelAnimationFrame(frame);
      if (layoutFrame) win.cancelAnimationFrame(layoutFrame);
      if (throttle !== null) win.clearTimeout(throttle);
      autoHide.destroy();
      for (const fn of cleanups.splice(0)) fn();
      dom.element.remove();
    },
  };

  host.append(dom.element);
  render();
  if (!(view as ToolbarView | null)?.pinned) autoHide.activity();
  relayout();
  return controls;
}

/* ------------------------------------------------------------------ helpers */

type SimpleCommand = Exclude<Command, { kind: "speed" }>;

const COMMAND_KINDS: ReadonlySet<string> = new Set<SimpleCommand["kind"]>([
  "close",
  "togglePlay",
  "toggleSound",
  "toggleTour",
  "replay",
  "goLive",
  "record",
]);

function isCommandKind(value: string): value is SimpleCommand["kind"] {
  return COMMAND_KINDS.has(value);
}

function toolbarText(i18n: I18n): ToolbarText {
  const t = translator(i18n);
  return {
    toolbar: t("toolbar.label"),
    progress: t("progress.label"),
    speed: t("toolbar.speed"),
    speedOption: (speed) => t("toolbar.speedOption", { speed }),
    shortcut: (label, key) => t("toolbar.shortcut", { label, key }),
    play: t("toolbar.play"),
    pause: t("toolbar.pause"),
    sound: t("toolbar.sound"),
    tapForSound: t("toolbar.tapForSound"),
    soundLocked: t("toolbar.soundLocked"),
    tour: t("toolbar.tour"),
    tourHint: t("toolbar.tourHint"),
    replay: t("toolbar.replay"),
    goLive: t("toolbar.goLive"),
    goLiveHint: t("toolbar.goLiveHint"),
    close: t("toolbar.close"),
    record: t("toolbar.record"),
    keySpace: t("key.space"),
    keyEsc: t("key.esc"),
    percent: percentFormatter(i18n.locale),
  };
}

function percentFormatter(locale: string): ToolbarText["percent"] {
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  } catch {
    format = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 });
  }
  return (fraction) => {
    let number = "";
    let unit = "";
    let unitFirst = false;
    for (const part of format.formatToParts(fraction)) {
      if (part.type === "percentSign") {
        unit = part.value;
        unitFirst = number === "";
      } else if (part.type !== "literal") {
        number += part.value;
      }
    }
    return { number, unit, unitFirst };
  };
}

/** What changes the full layout's width (control set per phase, sound hint): a change may need a relayout. */
function layoutSignature(view: ToolbarView): string {
  return `${view.phase}|${view.sound.hint}|${view.record}`;
}

/** True when the first and last items sit on different rows of the (flex-wrap) bar. */
function wraps(items: readonly HTMLElement[]): boolean {
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last || first === last) return false;
  return last.getBoundingClientRect().top - first.getBoundingClientRect().top > 4;
}

function matchesFocusVisible(el: Element | null): boolean {
  if (!el) return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === 11 && "host" in node;
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function validDelay(ms: number | undefined): number {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : AUTO_HIDE_MS;
}

/** Reports an error the way an uncaught one would be (console + window "error" event), without throwing. */
function reportFailure(win: Window, error: unknown): void {
  const report = (win as Window & { reportError?: (e: unknown) => void }).reportError;
  if (typeof report === "function") report.call(win, error);
  else console.error(error);
}

function validate(opts: ToolbarOptions): void {
  if (!opts || typeof opts !== "object") throw new TypeError("createControls() needs an options object");
  const host = opts.host as Partial<HTMLElement> | undefined;
  if (!host || typeof host.append !== "function" || !host.ownerDocument) {
    throw new TypeError("createControls(): `host` must be an element in a document");
  }
  const player = opts.player as Partial<Player> | undefined;
  if (!player || typeof player.on !== "function" || typeof player.pause !== "function") {
    throw new TypeError("createControls(): `player` must implement the Player interface");
  }
  if (!opts.i18n || typeof opts.i18n.t !== "function") {
    throw new TypeError("createControls(): `i18n` must provide t()");
  }
  if (typeof opts.soundLocked !== "function" || typeof opts.onUnlockSound !== "function") {
    throw new TypeError("createControls(): `soundLocked` and `onUnlockSound` must be functions");
  }
}
