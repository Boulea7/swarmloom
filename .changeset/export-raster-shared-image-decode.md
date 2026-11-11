---
"@swarmloom/export": patch
---

Exporting a PDF in the browser no longer holds the page for about 0.1 s on most frames. The frame snapshot gave a page bitmap to its cropped layers through a CSS custom property, and Chromium decoded the bitmap again for every layer that showed; the image clones now share a class that names the image itself, so it is decoded once a frame. On the brochure example the main-thread tasks over 50 ms fell from 37 to 1 in 180 frames.
