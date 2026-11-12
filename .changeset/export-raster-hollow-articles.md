---
"@swarmloom/export": patch
---

Exporting a long live page in the browser is faster when its sections, headings, paragraphs, lists and quotes have no border or padding: those away from the viewport are now written as empty boxes too, with the margins their content shares with them. Boxes holding SVG icons with ids (the clip paths and gradients design tools export) are written empty as well; the SVG elements something written refers to are written on their own, drawn nowhere. In Chromium at 1280 × 720, a frame's snapshot of a 5,800-element article took about 0.2 s instead of 1.6 s (its SVG 84 KiB instead of 790 KiB), and of 1,100 cards with clip-path icons about 0.25 s instead of 2.1 s. Firefox, which has no CSS Typed OM, writes a block empty only when its last content's margins cannot pass its bottom.
