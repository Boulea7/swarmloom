# src/ui

Owner: ui zone. The built-in toolbar (`createControls`, see `../internal.ts` "ui + i18n").

| Module | Responsibility |
| --- | --- |
| `index.ts` | `createControls`: mounts the toolbar into `Stage.uiLayer`, wires player events, pointer, resize and keyboard |
| `view-model.ts` | Pure state: which controls exist per player phase, labels, progress text and ETA |
| `actions.ts` | Runs toolbar commands against the `Player` (buttons and shortcuts share it) |
| `keyboard.ts` | Shortcut map (Esc, Space, M, T, 1/2/3, R, L) with modifier, IME, repeat and text-field guards |
| `toolbar.ts` | DOM built once inside its own shadow root, updated by compare-before-write |
| `styles.ts`, `icons.ts` | Glassy pill styles (light/dark, compact, reduced motion, forced colours) and original 1.5 px line icons |
| `autohide.ts` | Hide after ~2.5 s without pointer activity while building; tap on the stage toggles on touch |
| `placement.ts` | Fold-aware placement from `window.viewport.segments` |
| `announcer.ts` | Live-region milestones: start, halfway, done |

The toolbar never feeds the engine clock, so its wall-clock timers do not affect exports.
