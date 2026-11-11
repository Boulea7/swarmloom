---
"@swarmloom/snapshot-dom": patch
---

Snapshots of pages with many shadow roots are faster: a style sheet that many components adopt is checked for CSS counters once per snapshot instead of once per shadow root.
