---
"@swarmloom/export": patch
---

After go live, the animations in the open shadow roots of the live page are frozen, seeked to the frame time and read again after the page's next rendering update, as the page's own are, and their style sheets count for that wait. Before, only the page's document was read (`Document.getAnimations()` leaves shadow trees out), so on a live page with open shadow roots (one a custom `load` gives) a transition there, such as one a scroll-state query starts once go live scrolls the page, ran on wall time through the frame's screenshot or snapshot.
