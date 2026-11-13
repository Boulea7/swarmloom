---
"@swarmloom/export": patch
---

A browser export now draws an anchor-positioned box where `swarmloom render` shows it once its anchor has scrolled: a tooltip fixed to an anchor in the page, or one placed beside an anchor in a scroller, follows the anchor as the page scrolls. Before, it stayed where it was laid out before the scroll, so after going live it could be missing from every frame. A box placed in a `position-area` cell is now drawn in that cell rather than at the corner of its containing block. Where the export cannot tell where such a box goes (a box around it that transforms or zooms it, a transform of its own beyond a 2D translation, a containing block it cannot be sure of, or a pseudo-element), the box stays where its insets put it.
