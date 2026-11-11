---
"@swarmloom/snapshot-dom": patch
---

Pages that use CSS counters no longer block the main thread while they are captured: the counter values are counted alongside the time-sliced walk instead of in one whole-document pass at the first `counter()` (a 154 ms task on a 15,000-element page), and each `::before` / `::after` style is read once.
