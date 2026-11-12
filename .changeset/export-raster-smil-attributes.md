---
"@swarmloom/export": patch
---

Exporting in the browser now draws SVG SMIL animations that change no CSS property. The frame rasteriser copied each attribute's authored value, so `animateMotion` paths, and animations of attributes such as a line's `x2`, a polygon's `points`, a gradient stop's `offset` or a `viewBox`, stayed at their start in every frame: the shuttle in `examples/svg/shuttle.svg` never moved in the tail, while the CLI's video showed it moving. The rasteriser now writes the animated values, and the motion as part of the element's transform.
