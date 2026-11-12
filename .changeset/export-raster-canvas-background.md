---
"@swarmloom/export": patch
---

The in-browser exporter paints the background images of a page's root or body (gradients included) over the whole canvas, as the browser does, instead of only inside the element's own box. A live page with `body { background: linear-gradient(...) }` no longer shows a band of gradient on white after it goes live; the images are sized and placed against the root's box and repeat out to the viewport's edges, like the CLI's screenshots.
