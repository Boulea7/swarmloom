---
"@swarmloom/core": minor
"@swarmloom/adapter-three": patch
"swarmloom": patch
---

3D model exports are fast again since the engine ticks at 120 Hz: the WebGL scene renders only on the ticks a frame is captured after, with the same frames as before. A 4 s render of the loom-bot sample takes about 8 s instead of 21 s at 15 fps, and 10 s at 30 fps about 52 s instead of 154 s; the Studio's in-page export gains the same way. `Plugin.frame(now, dt, draw)` gets `draw` false on an export's ticks between two captured frames; a player paused right after such ticks calls it once more with `dt` 0 before its next captured frame.
