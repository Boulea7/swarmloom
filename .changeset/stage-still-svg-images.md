---
"@swarmloom/core": patch
---

An animated SVG image (SMIL or CSS animation in an image layer's source) now holds still on the stage instead of running on the browser's clock, so two renders of a Markdown or HTML page with an animated SVG give the same frames. SVG `data:` URLs and same-origin `.svg` files are covered; cross-origin SVG files keep their own clock.
