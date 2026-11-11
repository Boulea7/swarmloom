# src/engine

Owner: engine team. Also owns `src/player.ts`, `src/clock.ts`, `src/rng.ts`, `src/plugin.ts` and `src/index.ts`.

`createPlayer` (`../player.ts`) binds `assemblePlayer` (`assemble.ts`) to the other zones, which wires resolveTheme -> createStage -> createSound -> createControls -> `Engine`. The engine implements `Player` and drives everything from one clock.

`player.ts` imports the real zones (`src/theme.ts`, `src/stage/index.ts`, `src/choreo/index.ts`, sound, ui, i18n). The engine itself is tested against fakes through `assemblePlayer`; `test/core.test.ts` plays a tiny blueprint through the real `createPlayer`.

| Module | Role |
|---|---|
| `assemble.ts` | Option validation and player assembly from the zone factories (`PlayerZones`); releases what it created when a zone throws |
| `engine.ts` | `Engine`: state machine (idle, intro, building, paused, finale, done, live, destroyed), frame loop, player and task timelines, events, sound log, eta, ready, replay, seek, finish, go live |
| `planner.ts` | Task DAG (parent before child, master subtree before duplicate, guide before snapping text), reading order, priority tiers, unlock positions, cycle and dangling-reference diagnostics |
| `schedule.ts`, `heap.ts` | Runtime task state: dependency counts, unlock boundary, available set, pick scoring (viewport, then above, then below), progress and ETA aggregates |
| `build.ts`, `runner.ts`, `fallback.ts` | Choreography lookup (later plugins override earlier task keys), generator driving (yield ms, undefined or a promise), timeouts, cleanup of overlays and unfinished layers |
| `agent.ts`, `easing.ts`, `steer.ts` | `AgentApi` per cursor: bent minimum-jerk travel with a tiny overshoot, straight drags, steering physics |
| `roster.ts`, `crew.ts`, `labels.ts` | Agent pool: join from the edges, wander, retire, leave; names, "Agent 07", role and custom labels |
| `camera.ts` | Scroll speed estimate (more agents on fast scrolls) and the tour, which never scrolls past unfinished work |
| `intro.ts` | Warp opening: cursors shuttle on a band behind the icon for 1.5 to 2.5 s, then fan out |
| `finale.ts`, `flock.ts`, `spatial-hash.ts`, `halo.ts` | Finale: boids around the pointer with a uniform-grid hash, halo rings driven by sound levels, or fade out |
| `crossfade.ts` | Cursor-free build in plan order (reduced motion, finish now) |
| `streams.ts`, `options.ts`, `events.ts`, `constants.ts` | Seeded random streams, option validation, the event hub, tunables |

Determinism: nothing here calls `Math.random`, `Date.now` or `performance.now`. All randomness comes from streams derived from `PlayerOptions.seed` and stable ids (agent index, layer id), and all time comes from the clock. With a `VirtualClock`, equal options and steps give equal frames and an equal `soundLog`.
