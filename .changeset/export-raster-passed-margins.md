---
"@swarmloom/export": patch
---

A browser export no longer moves content up when the bottom margin of a block's last child collapses through the block (a paragraph in an unstyled wrapper): the written block keeps that margin. Chromium and WebKit only; Firefox has no CSS Typed OM to tell an `auto` height.
