---
"@swarmloom/core": minor
"@swarmloom/export": minor
"swarmloom": minor
---

`SoundOptions.beatSync: "all"` (CLI `--beat-sync all`) also puts keys, clicks, snaps, pen anchors and heading ticks on the nearest sixteenth note, at most 30 ms early or 60 ms late and one per sound and sixteenth; hits farther off stay silent. `soundTimes()` tells when each logged event is heard, and `--events-out` records it as `at` next to each event.
