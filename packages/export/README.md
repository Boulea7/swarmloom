# @swarmloom/export

Deterministic video and audio export for SwarmLoom.

## Render page (used by the CLI)

`dist/render/index.html` is a headless page, also exported as `@swarmloom/export/render/*`. It sets `window.__swarmloom` and marks `<html data-swarmloom="ready">`. A driver such as the `swarmloom render` CLI over CDP calls:

1. `init({ input, width, height, fps, seed?, agents?, speed?, theme?, sound?, tail?, follow?, reducedMotion?, bpm?, pack? })`, which returns `{ estimatedMs }`.
   - `input` is `{ name, type?, base64? | text? | url? }`. If `type` contains a slash it is a MIME type; otherwise it is an adapter id or extension that overrides detection.
   - The player runs inline at `width` x `height` on a `VirtualClock`, with controls off.
2. `step(1000 / fps)` advances the clock, waits for `player.ready()` (fonts, images, decode) and returns `{ state, built, total, done }`. Take a screenshot after each step until `done`. A run is done once the build has finished and `tail` ms (default 2500) have passed.
3. `audioWav()` returns the run's sound log rendered offline to a 48 kHz stereo WAV, as base64. It is the same length as the video.
4. `dispose()`.

Invalid `init` options reject with a `TypeError` that names the field. Only one render can be active per page.

## Library

- `exportFrames(playerOptions, { fps, onFrame, tailMs?, maxDurationMs?, signal? })` runs a player on a `VirtualClock`. It calls `onFrame(index, timeMs)` for each frame once the frame's assets are ready, and returns `{ frames, durationMs, soundLog }`. Frame `n` shows engine time `n * 1000 / fps`.
- `renderAudioWav(soundLog, durationMs, options?)` renders sound events to WAV bytes with `OfflineAudioContext`.
- `RenderSession` is the clock-and-player stepping used by both of the above.
- `createRenderApi(deps)` builds the `window.__swarmloom` object with your own loader and player factory.

License: MIT.
