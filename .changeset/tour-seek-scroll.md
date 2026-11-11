---
"@swarmloom/core": patch
---

Seeking with follow "tour" no longer freezes on long pages: the scroller is written once when the seek draws instead of on every simulated frame, and typed texts are measured before each frame's DOM writes. A 160 s seek of a 4.4k-layer page drops from about 27 s to under 3 s.
