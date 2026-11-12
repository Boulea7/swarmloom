---
"@swarmloom/export": patch
---

The render page now also swaps animated video posters and image buttons (`<input type="image">`) on the live page for still copies before the first frame. Neither is in `document.images`, so after go live they played on the browser's clock and two CLI renders of the same page gave different tail frames.
