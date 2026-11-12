---
"@swarmloom/export": patch
---

A browser export of a long live page with an animation running no longer reads every box away from the viewport on every frame: a box written empty or left out is written as the last frame wrote it while nothing in it, around it or in the sheets changed and it stayed away. In Chromium at 1280x720, the frames after going live on a page of 1,100 cards with one CSS animation took about 195 ms each and now take about 75 ms (100 cards: about 58 ms). `SnapshotStats.reused` counts those boxes.
