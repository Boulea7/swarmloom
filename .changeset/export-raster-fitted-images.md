---
"@swarmloom/export": patch
---

Exporting a page with large photos in the browser no longer holds the page for about 0.3 s a frame. The frame snapshot embedded every `<img>` at its full size, and the snapshot image decodes all it embeds again on every frame that changed; a large photo is now embedded halved as often as its box allows, each copy made once. The long data URLs of a frame are also escaped and URI-encoded once rather than on every frame. Eight 1600 x 1200 photos shown as 300 x 225 thumbnails: 8 s of video took 8 s to export instead of 54 s, with 4 long tasks instead of 247.
