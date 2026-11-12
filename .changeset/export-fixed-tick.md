---
"@swarmloom/export": minor
"swarmloom": patch
---

Exports no longer depend on the frame rate: the player takes 120 steps a second whatever `--fps` is, so 15, 24, 30 and 60 fps (any rate that divides 120) film the same build, only sampled more or less often. `RenderSession` takes the new `tickRate` option for this; `exportFrames` and the render page use 120. Takes change once: the build runs on the finer steps (often a little faster), so re-check cue frames when re-recording.
