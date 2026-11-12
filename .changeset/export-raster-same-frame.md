---
"@swarmloom/export": patch
---

A browser export no longer encodes and decodes the frame image again when the page held still and only the cursors moved: a frame whose snapshot is the same as the last one's draws the last image again. Between 17 and 54 % of the frames of the examples were the same as the frame before.
