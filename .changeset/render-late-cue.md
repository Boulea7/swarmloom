---
"@swarmloom/export": patch
"swarmloom": patch
---

A `--cue` after the build's natural end is no longer dropped. The video stopped when the tail ran out, so a later cue never ran, and a `live` cue had already turned off the automatic go live: `--cue 15:live` on a build that ends at 5 s gave a video that never showed the page. `RenderSession` now stays not done until every cue has applied, so the video runs on to the last cue (and a cued go live until the page shows) however long the build takes; the render page's length estimate counts the cues too. `render` also rejects a cue that would come after the last frame, not only one at or after the end of the video.
