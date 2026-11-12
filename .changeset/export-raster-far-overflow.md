---
"@swarmloom/export": patch
---

Each frame of a browser export of a long live page takes less time. What overflows a box away from the viewport is read once for the boxes in flow in it, from that box's scroll size, and not at all for boxes below or right of the viewport, whose overflow cannot reach into it. In Chromium at 1280 × 720, a frame after going live on a page of 1,100 cards (5,000 elements) took about 170 ms instead of 240 ms.
