---
"@swarmloom/export": patch
---

Exporting a 3D model in the browser no longer encodes its WebGL canvas as a PNG every frame. The canvases painted last, the model and the cursor layer over it, are drawn over the frame in paint order, including under the stage's scaled world; a canvas under a layer of a higher z-index still goes into the image. On the shuttle example a frame's SVG shrank from 445 KiB to 34 KiB and its snapshot took 36 ms instead of 78 ms.
