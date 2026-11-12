---
"@swarmloom/core": patch
"@swarmloom/export": patch
---

Animated GIF, APNG, WebP and AVIF images that an SVG embeds (`<image>`, `<feImage>`, or an `<img>` in a `<foreignObject>`) now show their first frame on the stage, as image layers already did for the same files on their own. An inline `<svg>` with an animated GIF is captured as an SVG image layer, so two CLI renders of such a page gave different frames while it built. The render page also holds the `<image>` and `<feImage>` elements of the live page's inline SVG, and text layers those of their inline SVG, on their first frame. `holdSvgImages` is exported from `@swarmloom/core` for that.
