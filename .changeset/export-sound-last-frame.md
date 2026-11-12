---
"@swarmloom/export": patch
"swarmloom": patch
---

The soundtrack now covers the last frame. Exports stopped the clock at the last frame's time while the video and its WAV last one frame longer, so the sounds due in that last 1/fps were missing and two frame rates that divide 120 could give different soundtracks. The CLI, the Studio export and `exportFrames` now run the clock on to the end of the video, without a capture, before they read the sound log. In `--events-out` a sound logged after the last frame's time gets that frame's number, and the scroll stretches are still read at the last frame. A one-frame CLI render now gets a soundtrack as well.
