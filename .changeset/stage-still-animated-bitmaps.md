---
"@swarmloom/core": patch
"@swarmloom/export": patch
---

Animated GIF, APNG, WebP and AVIF images now show their first frame on the stage (image layers, icons inside a line of text and video posters) instead of playing on the browser's clock, so two CLI renders of a page with an animated image give the same frames. `data:` URLs and same-origin files and `blob:` URLs are covered; cross-origin files keep their own clock. The render page also swaps the live page's animated `<img>` elements (SVG and bitmaps) for still copies before the first frame, so the go-live tail repeats too. `stillImageSource` is exported from `@swarmloom/core` for that.
