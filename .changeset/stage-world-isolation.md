---
"@swarmloom/core": patch
---

Cursors stay above the content when the stage shows it at exactly scale 1: the world now always has its own stacking context, so layers with a z-index no longer paint over the cursor overlay.
