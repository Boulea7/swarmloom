# src/engine

Owner: engine team. Also owns `src/player.ts`, `src/clock.ts`, `src/rng.ts`, `src/plugin.ts` and `src/index.ts`.

`createPlayer` (`../player.ts`) binds `assemblePlayer` (`assemble.ts`) to the other zones, which wires resolveTheme -> createStage -> createSound -> createControls -> `Engine`. The engine implements `Player` and drives everything from one clock.

`player.ts` imports the real zones (`src/theme.ts`, `src/stage/index.ts`, `src/choreo/index.ts`, sound, ui, i18n). The engine itself is tested against fakes through `assemblePlayer`; `test/core.test.ts` plays a tiny blueprint through the real `createPlayer`.

| Module | Role |
|---|---|
| `assemble.ts` | Option validation and player assembly from the zone factories (`PlayerZones`); releases what it created when a zone throws |
| `engine.ts` | `Engine`: state machine (idle, intro, building, paused, finale, done, live, destroyed), frame loop, player and task timelines, events, sound log, eta, ready, replay, seek (and the seek bar's timeline), finish, go live |
| `planner.ts` | Task DAG (parent before child, master subtree before duplicate, guide before snapping text), reading order, priority tiers, unlock positions, cycle and dangling-reference diagnostics |
| `schedule.ts`, `heap.ts` | Runtime task state: dependency counts, unlock boundary, available set, pick scoring (only work in sight: guides first, then reading position and distance), progress and ETA aggregates |
| `build.ts`, `runner.ts`, `fallback.ts` | Choreography lookup (later plugins override earlier task keys), generator driving (yield ms, undefined or a promise), timeouts, cleanup of overlays and unfinished layers |
| `agent.ts`, `easing.ts`, `steer.ts` | `AgentApi` per cursor: bent minimum-jerk travel with a tiny overshoot, straight drags, steering physics |
| `roster.ts`, `crew.ts`, `labels.ts` | Agent pool: join from the edges, wander, retire, leave; names, "Agent 07", role and custom labels |
| `camera.ts` | Scroll speed estimate (more agents on fast scrolls) and the tour, which never scrolls past unfinished work (and moves on faster while the crew has nothing in sight) |
| `intro.ts`, `outline.ts` | Warp opening: cursors shuttle on a band behind the icon for 1.5 to 2.5 s, then fan out. Outline opening: up to three cursors (fewer with a smaller pool) take only the largest shapes in view, two each, until all are taken, then the swarm is called |
| `finale.ts`, `flock.ts`, `spatial-hash.ts`, `halo.ts` | Finale: boids around the pointer with a uniform-grid hash, halo rings driven by sound levels, or fade out |
| `crossfade.ts` | Cursor-free build in plan order (reduced motion, finish now, and the out-of-sight fill below) |
| `streams.ts`, `options.ts`, `events.ts`, `constants.ts` | Seeded random streams, option validation, the event hub, tunables |

Cursors only work where the viewer can look: a task is picked only when the visible part of its layer (box cut by its clip) meets the viewport. When the crew has had nothing in sight to build for `IDLE_RUSH_MS` while the camera stood still (no tour step, no user scroll), everything left fades in without cursors in under a second. So a page the viewer does not scroll still completes, and the swarm never works out of sight; in tour mode this only covers work the tour cannot reach.

Each clock tick opens with the stage's read phase (`Stage.measure`), before any task writes to the DOM, and every task start names its layer to the stage (`Stage.prefetch`). Typed texts get their caret geometry measured there, on the layout the browser just finished, instead of forcing a layout mid-frame after other agents' writes. `seek()` frames have no read phase: no frame renders between them, so the layout is never clean and every read would force one. Instead the stage reads when a task asks for a caret it has not measured yet, and takes every pending text under the one layout that read forces.

Determinism: nothing here calls `Math.random`, `Date.now` or `performance.now`. All randomness comes from streams derived from `PlayerOptions.seed` and stable ids (agent index, layer id), and all time comes from the clock. With a `VirtualClock`, equal options and steps give equal frames and an equal `soundLog`.
