---
"@swarmloom/adapter-lottie": patch
---

A `.lottie` whose manifest sets a background colour is now woven on that colour (and the timeline picks the matching light or dark scheme) when no solid fills the canvas, instead of always on the light paper; a translucent manifest colour is blended over the paper and a fully transparent one is ignored.
