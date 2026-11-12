---
"@swarmloom/export": patch
"swarmloom": patch
---

Videos no longer end in the middle of going live. With `--live-top` the default `--tail` is 3700 ms instead of 2500, since the glide back to the top takes up to 1.2 s; the in-browser export and the render page use the same default. When a tail runs out while the page is still going live (cursors leaving, the glide back to the top), the video runs on until the page shows. `RenderSession` holds `done` for this, for up to 2.5 s after going live.
