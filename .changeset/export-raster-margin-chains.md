---
"@swarmloom/export": patch
---

A browser export of a page built from deeply nested wrappers (framework markup) no longer slows down with their depth: the frame snapshot reads each box of a chain of plain wrappers once for the margins passed through it, instead of once for every wrapper above it. In Chromium at 1280 × 720, a frame of 40 cards, each 40 wrappers deep, took about 0.34 s instead of 0.7 s.
