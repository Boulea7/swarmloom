---
"@swarmloom/core": patch
"@swarmloom/export": patch
---

Animated GIF, APNG, WebP, AVIF and SVG images used as CSS images (box and text backgrounds, masks, border images, list markers, inline styles inside text and the page background) now show the same still copy as image layers instead of playing on the browser's clock, and `ready()` waits for the copy. Two CLI renders of a page with such a background now give the same frames. The render page also overrides the live page's animated CSS images of elements (not pseudo-elements) before the first frame. `holdAllCssImages` is exported from `@swarmloom/core` for that.
