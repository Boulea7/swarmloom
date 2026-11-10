# src/sound

Owner: sound zone. WebAudio synthesis for SwarmLoom: no audio files, every sound is generated.

| Module | Role |
|---|---|
| `index.ts` | Zone entry: `createSound` (internal, wired by the player), `renderOffline`, `encodeWav`, `quantize` (public). |
| `realtime.ts` | `createSound`: live engine with autoplay-lock detection, unlock from any page gesture, smooth mute, idle suspend, levels and microphone. |
| `offline.ts` | `renderOffline`: renders a `SoundEvent` log on an `OfflineAudioContext`, bit-identical for the same events, options and browser. |
| `wav.ts` | `encodeWav`: 16-bit PCM RIFF/WAVE, all channels interleaved. |
| `quantize.ts` | Pure eighth-note grid from t = 0 (default 112 BPM). |
| `policy.ts` | Which events sound and when (shared by live and offline): grid snapping, one `note` per eighth slot (extras dropped, never queued), rate limits for typing and clicks, one-shot de-duplication. |
| `synth.ts`, `voice.ts` | Voice graphs, voice cap (24, priority-based stealing) and the fixed mixer. |
| `bus.ts` | Master bus: generated short stereo room (convolver), gentle compressor, volume and mute with `setTargetAtTime` ramps. |
| `levels.ts`, `microphone.ts` | Smoothed loudness + 16 log-spaced bands for the halo finale; optional microphone input (analysed only, never played back). |
| `scale.ts`, `packs/` | A major pentatonic material and the packs `studio` (default), `soft`, `8bit`, `silent-keys`. |

## Event mapping

- `note`: `pitch` 0..1 picks the register (three octaves from A3), `pan` (cursor x) picks the scale degree, so melodies rise left to right.
- `tick`: `pitch` is the step index of a rising pentatonic run.
- `pan` is scaled to 80% width; keys and clicks are nearly dry, notes and phrase marks are sent to the room.

## Determinism rules

- Every random value (detune, noise offsets, room impulse, noise buffer) comes from `createRng`, keyed by the render seed and the event index.
- Envelopes end at exactly 0 before their sources stop, so the moment the main thread disconnects finished nodes never changes a sample.
- No node input ever mixes more than two live signals (`Junction`, mixer slots). Chromium adds the connections of one input in an order that varies between runs; float addition of two operands is exact in either order, three or more are not.
- Offline events are scheduled in 2 s slices while rendering (`suspend`/`resume`) to bound live node count on long exports.

## Lock model

`locked` is true while sound is wanted (enabled or microphone on) and the context is not running. Events are dropped while locked, except the latest `chord`, which plays on unlock (a later `sweep` discards it). Any `pointerdown`, `mousedown`, `touchend` or `keydown` on the page tries to resume; `unlock()` does the same from a toolbar handler.
