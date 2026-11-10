/**
 * Keyboard shortcuts: Esc close, Space pause/resume, M sound, T tour, 1/2/3 speed, R replay, L go live,
 * F finish now.
 *
 * Shortcuts are skipped when Ctrl/Alt/Meta/Shift is held, during IME composition, on auto-repeat,
 * while a text field has focus, and (for Space) while a button or link has focus so its own
 * activation wins. Handled keys are consumed so the page underneath does not also react.
 */

import { isActivatable, isEditable } from "./dom";
import type { Command } from "./view-model";

/** The subset of KeyboardEvent the mapper reads (lets tests pass plain objects). */
export interface KeyInput {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

const LETTERS: Readonly<Record<string, Command>> = {
  m: { kind: "toggleSound" },
  t: { kind: "toggleTour" },
  r: { kind: "replay" },
  l: { kind: "goLive" },
  f: { kind: "finish" },
};

/** Physical keys, used when the layout produces a non-Latin character (Cyrillic, Greek...). */
const CODES: Readonly<Record<string, Command>> = {
  KeyM: LETTERS.m as Command,
  KeyT: LETTERS.t as Command,
  KeyR: LETTERS.r as Command,
  KeyL: LETTERS.l as Command,
  KeyF: LETTERS.f as Command,
  Digit1: { kind: "speed", speed: 1 },
  Digit2: { kind: "speed", speed: 2 },
  Digit3: { kind: "speed", speed: 3 },
  Numpad1: { kind: "speed", speed: 1 },
  Numpad2: { kind: "speed", speed: 2 },
  Numpad3: { kind: "speed", speed: 3 },
};

/** Maps a key press to a toolbar command, or null when the key is not a shortcut. */
export function commandForKey(e: KeyInput): Command | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  if (e.isComposing || e.keyCode === 229 || e.key === "Process" || e.repeat) return null;
  const key = e.key;
  if (key === "Escape" || key === "Esc") return { kind: "close" };
  if (key === " " || key === "Spacebar") return { kind: "togglePlay" };
  if (key === "1" || key === "2" || key === "3") return { kind: "speed", speed: Number(key) };
  if (key.length === 1) {
    const letter = LETTERS[key.toLowerCase()];
    if (letter) return letter;
    // A printable key outside ASCII (e.g. AZERTY "&" on Digit1, Cyrillic on KeyM): fall back to the physical key.
    if (!/[a-z0-9]/i.test(key) && e.code) return CODES[e.code] ?? null;
  }
  return null;
}

export type KeyboardScope = "auto" | "window" | "host" | "none";

export interface ShortcutBinding {
  win: Window;
  /** Element that represents the player (the stage's shadow host). */
  scope: Element;
  mode: KeyboardScope;
  /** True while focus is inside the toolbar (tracked by the toolbar; works across closed shadow roots). */
  focusInToolbar(): boolean;
  /** Runs the command; returns true when it did something (then the key is consumed). */
  dispatch(command: Command): boolean;
}

/** Listens for shortcuts on the window (capture phase). Returns an unbind function. */
export function bindShortcuts(binding: ShortcutBinding): () => void {
  const { win, scope, mode } = binding;
  if (mode === "none") return () => {};
  let engaged = false;

  const onPointerDown = (e: Event): void => {
    engaged = e.composedPath().includes(scope);
  };
  const onFocusIn = (e: Event): void => {
    engaged = e.composedPath().includes(scope);
  };

  const inScope = (e: KeyboardEvent): boolean => {
    if (mode === "window") return true;
    if (engaged || e.composedPath().includes(scope)) return true;
    return mode === "auto" && coversViewport(win, scope);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    const command = commandForKey(e);
    if (!command) return;
    const target = deepTarget(e, win.document);
    if (isEditable(target)) return;
    if (command.kind === "togglePlay" && (binding.focusInToolbar() || isActivatable(target))) return;
    if (!inScope(e)) return;
    if (!binding.dispatch(command)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("pointerdown", onPointerDown, true);
  win.addEventListener("focusin", onFocusIn, true);
  return () => {
    win.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener("pointerdown", onPointerDown, true);
    win.removeEventListener("focusin", onFocusIn, true);
  };
}

/** The innermost reachable event target, descending into open shadow roots of the focused element. */
function deepTarget(e: Event, doc: Document): EventTarget | null {
  const first = e.composedPath()[0] ?? e.target;
  if (first && first !== doc.body && first !== doc.documentElement && first !== (doc.defaultView as unknown)) {
    return first;
  }
  let active: Element | null = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** The player covers (almost) the whole viewport, as in overlay mode or a full-screen Studio player. */
function coversViewport(win: Window, scope: Element): boolean {
  const rect = scope.getBoundingClientRect();
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  if (vw <= 0 || vh <= 0) return false;
  const w = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
  const hgt = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
  return (w * hgt) / (vw * vh) >= 0.9;
}
