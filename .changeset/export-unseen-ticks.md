---
"@swarmloom/core": minor
"@swarmloom/export": patch
"swarmloom": patch
---

Exports at 15 or 30 fps are fast again since the engine ticks at 120 Hz: only the tick a frame is captured after repaints the cursor canvas, and image and media layers decode once instead of before every tick. A 15 fps render of a page with eight large photos takes about 6 s instead of 10 s, with the same frames. `VirtualClock.advance(ms, { draw: false })` advances a tick nobody sees; tick listeners get `draw` as a third argument. An overlay's icon image now starts loading when the overlay names it, not at its first paint.
