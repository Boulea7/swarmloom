---
"@swarmloom/export": patch
---

Exporting in the browser now draws the stage in Firefox. The frame rasteriser reset every element of each frame image with `all: unset`, the wrapping `<svg>` and `<foreignObject>` included, so their size became `auto` and Firefox drew nothing of the frame: every export came out as a white video that still reported success. The reset now covers only the copied page inside the `foreignObject`.
