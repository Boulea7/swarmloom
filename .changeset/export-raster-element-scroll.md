---
"@swarmloom/export": patch
---

In-browser exports now draw the content of scrolled boxes (other than the page itself) where the page shows it. Inline elements, such as the coloured spans of a scrolled code block, move with their text instead of staying behind; `::before` and `::after` move with the content; fixed boxes, and boxes positioned against something outside the scrolled box, stay where they are instead of moving out of view; white space between the items of a scrolled flex or grid container no longer adds gaps; and a scrolled `<textarea>` shows the lines in view instead of its first lines.
