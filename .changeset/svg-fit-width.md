---
"@swarmloom/adapter-svg": patch
---

`createSvgAdapter({ fit: "width" })` always scales a drawing to the layout width, for callers that lay it out in stage space themselves. The Lottie adapter uses it, so its woven frame lines up with the player and the timeline again after the 16:9 fitting of tall drawings.
