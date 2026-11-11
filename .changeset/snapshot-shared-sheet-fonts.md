---
"@swarmloom/snapshot-dom": patch
---

Snapshots of pages with many web components no longer stall for up to half a second while collecting `@font-face` rules: a style sheet adopted by every shadow root is now read once instead of once per root.
