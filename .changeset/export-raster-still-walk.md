---
"@swarmloom/export": patch
---

A browser export no longer serialises the page again while it holds still: when nothing in the frame's document mutated, loaded, scrolled, took focus or changed its Web Animations since the last frame, and the image holds no canvas or video pixels, same-origin frame or SMIL animation, the frame draws the last image again with the cursors over it. Such a frame took about 70 ms on `examples/web/demo.html` at 1280x720 and now takes under a millisecond; an opening of 2 s with an outline intro, 4 s at 30 fps, skips 103 of its 120 snapshots.
