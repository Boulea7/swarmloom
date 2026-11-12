---
"@swarmloom/core": patch
---

A page with more than 32 animated images (GIF, APNG, WebP, AVIF, or SVGs that embed one) no longer decodes and re-encodes every one of them again on each replay or seek back: the stage keeps their still copies up to 64 MiB instead of 32 copies. The copies, and the inlined images they were made from, are now dropped once the last player on the page is destroyed instead of staying in memory for the rest of the session.
