---
"@swarmloom/snapshot-dom": patch
---

A snapshot no longer mixes two layouts when the page reflows during the time-sliced walk (an image or font finishes loading, a timer grows a banner): the walk starts over, and after two torn walks the last one runs in a single task, so rows no longer jump, overlap or leave gaps.
