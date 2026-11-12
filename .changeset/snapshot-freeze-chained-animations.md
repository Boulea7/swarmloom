---
"swarmloom": patch
---

Web-page snapshots also freeze the animations that the freeze itself starts: a loop a page begins on `animationend`, `transitionend` or a video's `pause` (a spinner after an entrance, a blinking caret after a typewriter) is read half a cycle in, so two captures of the same URL no longer differ.
