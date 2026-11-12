---
"@swarmloom/core": patch
---

The stage keeps the exact offset of its own scrolls when the browser reports them back snapped to device pixels. The scroll event arrives with the browser's next rendering update, so cursors, name tags and the tour camera used to move by a fraction of a pixel depending on render timing, and two CLI renders of a page with the same seed could give different frames.
