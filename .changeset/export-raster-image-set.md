---
"@swarmloom/export": patch
---

Exporting in the browser now draws the `image-set()` option the CLI shows. Before, every option of a set was fetched and embedded in each frame (a page's 2x images too, though not drawn), and the browser drawing the frame chose among them by its own rules, so Firefox picked SVG and JPEG XL options that the CLI's Chromium skips. Each set is now narrowed to the option Chromium shows at one device pixel per CSS px before its images are embedded.
