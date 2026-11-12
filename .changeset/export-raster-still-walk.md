---
"@swarmloom/export": patch
---

A browser export no longer serialises the page again while it holds still: when nothing in the frame's document, or in the live page it went live to, mutated, loaded, scrolled, took focus or changed its Web Animations since the last frame, every canvas drawn into the image holds the same pixels, and the image holds no video, frame of another origin or SMIL animation, the frame draws the last image again with the cursors over it. Such a frame took about 70 ms on `examples/web/demo.html` at 1280x720 and now takes under a millisecond; an opening of 2 s with an outline intro, 4 s at 30 fps, skips 103 of its 120 snapshots. The go-live tail of a still page skips them too: the 75 frames after a live cue on a 60-section article took about 84 ms each and now take about 6 ms.
