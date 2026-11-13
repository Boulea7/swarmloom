---
"@swarmloom/adapter-three": patch
---

The 3D finale orbit no longer renders the WebGL scene on its own between frames: only orbit input from the viewer schedules an extra render, so an export's ticks between two captured frames stay unrendered during the finale too, and live playback renders each finale frame once instead of twice.
