---
"swarmloom": minor
"@swarmloom/export": minor
"@swarmloom/core": patch
---

`swarmloom render` can make repeatable takes timed to music: `--duration` captures an exact length, `--bpm` sets the tempo the placement notes snap to, `--cue <at>:<action>` pauses, resumes or finishes the build at fixed times, and `--audio-out`, `--events-out` and `--manifest-out` write the soundtrack, the sound log and a capture manifest with per-frame hashes. The render page accepts `cues`, reports the blueprint hash and exposes `soundLog()`. The intro icon keeps shrinking after the fan-out instead of freezing on screen.
