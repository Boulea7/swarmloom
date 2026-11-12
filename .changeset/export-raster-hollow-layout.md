---
"@swarmloom/export": patch
---

Exporting a long live page in the browser is faster: the empty boxes written for sections away from the viewport keep only the properties that size and place them, and their counters, instead of their whole computed style. On a 5,000-element page a frame's snapshot took about 0.2 s instead of 0.4 s, and its SVG shrank from 890 KiB to 490 KiB.
