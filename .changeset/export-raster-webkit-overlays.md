---
"@swarmloom/export": patch
---

Exporting in the browser now draws the cursor canvas and WebGL models over each frame in Safari too, as in Chromium and Firefox. WebKit has no `overflow-clip-margin` and reports it as an empty value, which the frame rasteriser took for a margin, so in Safari every canvas inside a clipping box was encoded into the frame image as a PNG on every frame.
