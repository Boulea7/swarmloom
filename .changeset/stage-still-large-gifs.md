---
"@swarmloom/core": patch
---

Animated GIFs over 16 MB, such as recorded demos, now hold their first frame instead of playing on the browser's clock: a GIF, or an APNG whose default image is its first frame, is read only up to the end of that frame, whatever its size. The formats page names the limits that remain (16 MB for animated WebP and AVIF, 2 MB for animated SVG).
