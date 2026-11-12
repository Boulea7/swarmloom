---
title: JavaScript API
description: createPlayer, format adapters, DOM snapshots, clocks and choreography plugins.
---

# JavaScript API

::: info Current status
Everything on this page is implemented: `createPlayer()` (`@swarmloom/core`), `load()` and the built-in adapters (`@swarmloom/formats`), `snapshot()` (`@swarmloom/snapshot-dom`), and `exportFrames()`, `renderAudioWav()` and `recordElement()` (`@swarmloom/export`). See [Formats](./formats.md) for how mature each format is. The packages are not on npm yet; use them from a source checkout for now.
:::

## From input to player

```ts
import { createPlayer } from "@swarmloom/core";
import { load } from "@swarmloom/formats";

const source = await load({
  name: "README.md",
  type: "text/markdown",
  text: "# Hello\n\nA swarm builds this paragraph.",
});

const host = document.querySelector<HTMLElement>("#stage");
if (!host) throw new Error("Missing #stage");

const player = createPlayer({
  blueprint: source.blueprint,
  plugins: source.plugins,
  host,
  mode: "inline",
  agents: "auto",
  speed: 1,
  seed: 7,
  controls: true,
  labels: "roles",
  follow: "tour",
  sound: { enabled: true, pack: "studio", volume: 0.7 },
  finale: "flock",
});

const offState = player.on("state", ({ state }) => {
  console.log(state);
});

await player.play(); // Resolves after the build, before the finale ends.

const dispose = () => {
  offState();
  player.destroy();
  source.dispose?.();
};
// Call dispose() from the host component's unmount hook.
```

In an application, keep `dispose()` in the host component's unmount path rather than running it immediately after initialisation. `LoadedSource.dispose()` may revoke object URLs, sandboxes and GPU resources, so call it after destroying the player.

## `createPlayer(options)`

`blueprint` is required. The remaining options are:

| Option | Type / default | Description |
| --- | --- | --- |
| `mode` | `"overlay"` / `"inline"` | Cover the live page, or play inside a scrolling `host` |
| `host` | `HTMLElement` | Shadow Root host; defaults to `document.body` in overlay mode |
| `agents` | `number` / `"auto"` | Cursor count; automatic mode scales between 8 and 64 |
| `speed` | `number`, default 1 | Speed multiplier above 0 |
| `seed` | `number` | Seed for all engine randomness |
| `clock` | `Clock` | Defaults to `RealtimeClock`; use `VirtualClock` for frame export |
| `sound` | `boolean` / `SoundOptions` | Enable, volume, pack, BPM and beat synchronisation |
| `theme` | `auto` / `light` / `dark` / `ThemeSpec` | Named theme or custom palette |
| `labels` | `LabelMode` / `string[]` | `names`, `agents`, `roles`, `none` or custom labels; `none` also hides status bubbles |
| `overlays` | `full` / `minimal` / `none`, default `full` | Editing marks while building: `minimal` leaves out size badges, distance labels, guide lines and rulers; `none` also leaves out selections, empty frames, pen lines and anchors, carets and status bubbles, so only the cursors, their name tags and the content remain. The intro icon and the halo finale are always drawn |
| `follow` | `scroll` / `tour` / `none` | Follow the user, tour automatically, or keep a fixed viewport |
| `reducedMotion` | `auto` / `boolean` | Defaults to the system reduced-motion preference |
| `intro` | `boolean \| "outline"` | Intro: `true` (default) is the icon orbit and fan-out; `"outline"` shows no icon, up to three cursors (fewer when `agents` is smaller) first draw the largest shapes in view (paths and boxes, two per cursor) and the rest joins once all of them are taken; `false` has no intro |
| `finale` | `flock` / `halo` / `none` | Flock, audio-reactive halo, or no finale |
| `opening` | `number`, default 0 | Ms to show the original first (inline: the finished content; overlay: the page), then fade into the blank canvas and start the intro |
| `liveTop` | `boolean`, default false | Going live glides back to the top while the cursors leave |
| `controls` | `boolean` | Show the built-in toolbar |
| `scrubber` | `boolean`, default false | Add a seek bar to the toolbar (drag or arrow keys); only with `controls` on. Seeking back replays the build from the start |
| `locale` | BCP 47 string | Toolbar language; defaults to `navigator.language` |
| `messages` | `Record<string, string \| plural forms>` | Toolbar strings for `locale`, keyed like the built-in catalogs (`toolbar.play`). They come first; missing or malformed ones fall back to the built-in catalog, then English. Core exports the catalogs as `CATALOGS` |
| `plugins` | `Plugin[]` | Custom choreographies, renderers or stage plugins |
| `onLive` | `() => void` | Callback after restoring live/final content |
| `onClose` | `() => void` | Player close callback |

`SoundOptions`:

| Member | Description |
| --- | --- |
| `enabled` | Enable sound |
| `volume` | Master volume from 0 to 1 |
| `pack` | `studio`, `soft`, `8bit`, `silent-keys` or a custom pack ID |
| `bpm` | Musical-grid tempo |
| `beatSync` | Snap sounds to the `bpm` grid: `true` (default) puts placement notes, the fan-out and the final chord on the next eighth note; `"all"` also puts keys, clicks, snaps, pen anchors and heading ticks on the nearest sixteenth note (at most 30 ms early or 60 ms late, one per sound and sixteenth; hits farther off stay silent); `false` keeps every sound at its event time |

Some events stay silent whatever `beatSync` is: events the pack has no voice for, a second placement note in the same eighth note, the opening swell, fan-out, final chord or sweep repeated within 400 ms, and typing, pointer sounds and ticks beyond 6, 5 and 4 per 100 ms. `soundTimes()` returns `null` for them.

`ThemeSpec` accepts `palette`, `accent`, `select` and `chrome`. Cursor colours cycle through `palette` in order.

## `Player`

| Member | Description |
| --- | --- |
| `state` | `idle`, `intro`, `building`, `paused`, `finale`, `done`, `live` or `destroyed` |
| `progress` | `{ built, total }` layer progress |
| `soundLog` | Read-only sound events emitted so far |
| `scrollY` | Optional: top edge of the view in stage px; exporters log its changes as scroll stretches |
| `play()` | Start opening, intro and build; resolves after the build, not after the finale |
| `pause()` / `resume()` | Pause or resume |
| `setSpeed(speed)` | Change speed |
| `setSound(enabled)` | Toggle sound |
| `setFollow(mode)` | Change follow mode |
| `replay()` | Reset and replay |
| `goLive()` | Return to the live page or final static content |
| `ready()` | Wait for images and fonts on currently mounted layers |
| `eta()` | Estimated remaining build time in ms at current speed |
| `finish()` | Optional: completes the remaining build within about a second, then starts the finale (toolbar "finish", key F) |
| `seek(t)` | Optional: jumps to `t` ms after `play()`; later times fast-forward, earlier ones replay from the start, with nothing drawn or played meanwhile |
| `setFinale(mode)` | Optional: changes the finale; applies immediately while it runs |
| `on(type, fn)` | Subscribe; returns an unsubscribe function |
| `destroy()` | Release player, stage, audio and plugin resources |

Event payloads:

```ts
type PlayerEvent =
  | { type: "state"; state: PlayerState }
  | { type: "progress"; built: number; total: number }
  | { type: "sound"; event: SoundEvent }
  | { type: "settings"; speed: number; sound: boolean; follow: "scroll" | "tour" | "none" }
  | { type: "error"; error: Error };
```

`settings` fires when `setSpeed`, `setSound` or `setFollow` changed a value (the built-in toolbar and its shortcuts call them too) and carries all three current values.

Unsubscribe application listeners during teardown and handle `play()` rejection rather than silently swallowing resource errors.

## Format loading and adapters

### `load(input, ctx?, options?)`

`@swarmloom/formats` detects the input, dynamically imports its adapter, and returns a `LoadedSource`:

```ts
interface LoadedSource {
  blueprint: Blueprint;
  plugins?: Plugin[];
  dispose?(): void;
}
```

`SourceInput` accepts `name`, `type`, `bytes`, `text`, `url` or `element`. Supply one primary representation that matches the content; `name` and `type` assist detection but do not replace content.

Outside a browser, pass `ctx.document` explicitly. `AdapterContext` contains:

| Member | Description |
| --- | --- |
| `document` | Document for hidden sandboxes, layout and measurement |
| `width` | Layout width for reflowable content |
| `theme` | `light` or `dark` |
| `locale` | Optional BCP 47 locale |
| `maxLayers` | Layer budget; reaching it sets `Blueprint.truncated` |
| `signal` | Optional cancellation signal |

The third argument is `LoadOptions`: `registry` (a custom registry, default `formats`), `format` (skip detection and name the adapter id, extension or MIME type), `maxBytes` (default 50 MB), `fetch` (URL-only inputs are downloaded first by default; `false` hands them to the adapter untouched) and `signal`. A registry array is accepted as shorthand for `{ registry }`.

Unknown formats, inputs over the size limit, empty inputs, encrypted documents and failed downloads reject with a `SourceError` whose `code` says why. Adapter errors for invalid input, missing assets and decoding failures propagate unchanged.

### Register an adapter

An adapter implements:

```ts
interface Adapter {
  id: string;
  label: string;
  extensions: string[];
  mime: string[];
  sniff?(head: Uint8Array, name?: string): boolean;
  load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource>;
}
```

`FormatEntry` adds a lazy loader. Add it to a custom registry without modifying core:

```ts
import { formats, load, type FormatEntry } from "@swarmloom/formats";

const entry: FormatEntry = {
  id: "my-format",
  label: "My format",
  extensions: ["mine"],
  mime: ["application/x-mine"],
  loader: () => import("./my-adapter").then((m) => m.myAdapter),
};

const source = await load(input, ctx, [...formats, entry]);
```

Adapters should honour cancellation and layer budgets, sanitise untrusted content, never execute document macros or scripts, and release resources in `dispose()`.

### `detect` and `formats`

- `detect(input, registry?)` resolves an adapter ID from extension, MIME and magic bytes.
- `formats` is the built-in `FormatEntry[]` registry with lazy adapter entry points.

## DOM snapshots

```ts
import { snapshot, snapshotHtml } from "@swarmloom/snapshot-dom";

const page = await snapshot(document, {
  origin: "document",
  maxLayers: 6000,
  prescroll: true,
  inlineImages: true,
});

const fragment = await snapshotHtml("<h1>Hello</h1>", {
  width: 1280,
  baseUrl: location.href,
  css: "h1 { font-family: system-ui; }",
});
```

`snapshot()` accepts `Element | Document`. Options:

| Option | Default / purpose |
| --- | --- |
| `origin` | `document` for Document/body/html, `element` for other elements |
| `source` | Source metadata written to the Blueprint |
| `maxLayers` | 6000; overflow preserves reading order and sets `truncated` |
| `maxHeight` | 60000 CSS px |
| `detectDuplicates` | true; repeated siblings become masters and duplicates |
| `detectGuides` | true; shared edges and baselines become guides |
| `screenshot` | Visible-viewport capture for WebGL, playing video and cross-origin iframes |
| `prescroll` | false; quick pre-pass to trigger lazy content |
| `inlineImages` | false; convert same-origin images to data URLs for another document |
| `signal` | Cancel the snapshot |

`prescroll(document, signal?)` runs the same pre-pass on its own. To fix the pose of animations after the pre-pass and before the snapshot, call it first, then call `snapshot()` with `prescroll: false`.

`snapshotHtml()` additionally requires `width` and accepts `css`, `document`, `baseUrl`, `background`, `scheme` and `icon`.

::: warning Security boundary
`snapshotHtml()` handles isolated layout and measurement; it is not a general HTML sanitiser. Sanitise untrusted HTML with an allowlist first. Scripts, event attributes, forms and external resources need a separate rejection policy.
:::

## Choreography plugins

Plugins add generator choreographies through `tasks` and custom-layer rendering through `renderers`. `setup`, `frame` and `project` support self-managed stages such as WebGL.

This small `demo:stamp` choreography moves a cursor, drags a placeholder, reveals in 12 steps, and cleans up its overlay:

```ts
import { definePlugin, type CustomLayer, type TaskGen } from "@swarmloom/core";

export const stampPlugin = definePlugin({
  name: "demo-stamp",
  tasks: {
    "demo:stamp": (agent, layer: CustomLayer, stage): TaskGen =>
      (function* (): TaskGen {
        const { x, y, w, h } = layer.box;
        const ghost = stage.overlay("ghost-rect", { x, y, w, h });

        try {
          agent.setCursor("move");
          agent.say("stamping");
          yield* agent.moveTo(x, y, { dur: 240, ease: "out" });
          agent.press();
          yield* agent.dragTo(x + w, y + h, { dur: 420, ease: "inOut" });

          for (let step = 1; step <= 12; step += 1) {
            stage.reveal(layer.id, step / 12);
            yield 35; // Engine milliseconds, scaled by player speed.
          }
          agent.sound("note", { vel: 0.6 });
        } finally {
          ghost.remove();
          agent.release();
          agent.say("");
          stage.finish(layer.id);
        }
      })(),
  },
});
```

Pass it to the player:

```ts
const player = createPlayer({
  blueprint,
  plugins: [stampPlugin, ...sourcePlugins],
});
```

The corresponding custom layer uses `kind: "custom"` and `task: "demo:stamp"`. A custom layer also needs a renderer under the same key; an adapter can package both in one plugin.

Choreography rules:

- Express duration through yielded milliseconds; `yield undefined` waits one frame.
- Use Promises only for asset decoding, never wall-clock timing.
- Use `agent.rng`, not `Math.random()` or `Date.now()`.
- Remove overlays, release presses and call `stage.finish()` in `finally`.
- `setup()` may return cleanup; `frame(now, dt, draw)` uses engine time. `draw` is false for an export's engine ticks between two captured frames: advance as usual, and leave a WebGL render to the next frame with `draw` true, which shows what the skipped ones changed.
- Optional `restSpot(vp, rng)` returns where an idle cursor rests next (stage px), so idle cursors stay off text the stage cannot see, such as a terminal screen; null keeps the default wandering in the middle of the viewport. Use only the given `rng` for randomness.
- A plugin that keeps state provides `perPlayer()`: every player calls it once and uses the fresh instance, so one `LoadedSource` can drive several players at once.
- `stage.reducedMotion` is true when the player builds without motion; keep still poses then instead of starting animations.
- Avoid per-frame DOM allocation and repeated layout reads.

## Clocks and randomness

```ts
import { RealtimeClock, VirtualClock, createRng } from "@swarmloom/core";

const realtime = new RealtimeClock({ maxDeltaMs: 100 });
const virtual = new VirtualClock();
const rng = createRng(42);

virtual.start();
virtual.advance(1000 / 30);
virtual.stop();
```

`VirtualClock.advance(ms)` advances only while running and emits exactly one tick. It cannot be re-entered from a tick callback, and rejects negative or non-finite values. `advance(ms, { draw: false })` emits a tick nobody sees: the player advances as usual but does not repaint its cursor canvas, and plugins get `draw` false in `frame()`. Exports advance the engine ticks between two captured frames this way.

The same seed and clock are only part of determinism. Fonts, input, viewport, adapters and plugin versions must also be fixed.

## Frame and audio export

`@swarmloom/export` provides:

- `exportFrames(playerOptions, { fps, onFrame, tailMs?, maxDurationMs?, onWarning?, signal? })`: drives a player frame by frame on a `VirtualClock`. It calls `onFrame(index, timeMs)` once each frame's assets are ready; frame `n` shows engine time `n * 1000 / fps`. It returns `{ frames, durationMs, soundLog, warnings }`. Recoverable player errors go to `onWarning` and `warnings` and the export continues; throw from `onWarning` to abort;
- `renderAudioWav(soundLog, durationMs, options?)`: renders the sound-event log with `OfflineAudioContext` to WAV bytes as long as the video;
- `recordElement(target, options?)`: call it from a click handler. It asks to share the current tab, crops the capture to the element and records live with `MediaRecorder`. It is not deterministic; `canRecordElement()` reports support, and failures throw a `RecordingError` with a `code`.

```ts
import { exportFrames, renderAudioWav } from "@swarmloom/export";

const { frames, durationMs, soundLog } = await exportFrames(
  { blueprint: source.blueprint, plugins: source.plugins, host, mode: "inline", seed: 7 },
  {
    fps: 30,
    tailMs: 2000,
    onFrame: async (index) => {
      await captureFrame(index); // e.g. take a screenshot or hand a canvas to an encoder
    },
  },
);
const wav = await renderAudioWav(soundLog, durationMs);
```

The `swarmloom render` command uses the same frame-by-frame pipeline; see [CLI](./cli.md).

Core also exports `renderOffline()`, `soundTimes()` (when each event sounds with the same settings, `null` when it stays silent) and `encodeWav()` for custom audio pipelines. Video exporters should always await `player.ready()` so fonts and images cannot be captured before decoding.
