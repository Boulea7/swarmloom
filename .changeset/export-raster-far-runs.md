---
"@swarmloom/export": patch
---

A browser export of a long live page writes the boxes far from the viewport that follow one another in block flow (sections, cards) as one empty box, so the frame image, and the time to decode it on every changed frame, no longer grows with the page: at 3000 cards a frame with one animation running took about 140 ms with a 70 ms main-thread task, and now about 60 ms with none. Boxes written empty also keep their exact size, so on a long page what shows no longer sits up to tens of px higher than in the CLI's frames.
