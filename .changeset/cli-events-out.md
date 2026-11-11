---
"swarmloom": patch
"@swarmloom/export": patch
---

`swarmloom render` can write the run's sound log next to the video (`--events-out <file>`, JSON with engine-ms timestamps on the same clock as the frames) and snap placement notes to a given tempo (`--bpm <n>`). The headless render page gains `soundLog()` for drivers.
