# src/ui

Owner: ui zone. The built-in toolbar (`createControls`, see `../internal.ts` "ui + i18n").

| Module | Responsibility |
| --- | --- |
| `index.ts` | `createControls`: mounts the toolbar into `Stage.uiLayer`, wires player events, pointer, resize, keyboard and the seek bar |
| `view-model.ts` | Pure state: which controls exist per player phase, labels, progress text, ETA and seek position |
| `actions.ts` | Runs toolbar commands against the `Player` (buttons and shortcuts share it); finish now and seek call the optional `Player.finish()` and `Player.seek()` |
| `keyboard.ts` | Shortcut map (Esc, Space, M, T, 1/2/3, R, L, F) with modifier, IME, repeat and text-field guards |
| `toolbar.ts` | DOM built once inside its own shadow root, updated by compare-before-write |
| `styles.ts`, `icons.ts` | Glassy pill styles (light/dark, compact, reduced motion, forced colours) and original 1.5 px line icons |
| `autohide.ts` | Hide after ~2.5 s without pointer activity while building; tap on the stage toggles on touch |
| `placement.ts` | Fold-aware placement from `window.viewport.segments` |
| `announcer.ts` | Live-region milestones: start, halfway, done |

While audio is locked, the first press on the sound button only unlocks it: the lock state is read when the press starts, because the sound engine resumes audio from its own page-wide listener before the click arrives.

The seek bar is opt-in: it appears only when the shell passes the `timeline` seam (`createPlayer({ scrubber: true })` does) and the player implements `seek()`. It is a native range input across the top of the pill, its own tab stop. Dragging previews the position and seeks on release (each seek replays the build from the start); arrows step 1 s, Page Up/Down 10 %, Home/End jump to the ends, and steps within one frame collapse into one seek. The length shown is the build's estimated length, which only grows within a run so the thumb does not slide back when the ETA is revised.

The toolbar has no finale menu; `Player.setFinale()` is left to shells that offer one.

The toolbar never feeds the engine clock, so its wall-clock timers do not affect exports.
