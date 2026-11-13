---
"@swarmloom/export": patch
---

After go live, a transition or animation that a seek starts (an element inheriting a seeked colour, a container query that a seeked size now matches) plays from its start at the frame time. Before, it ran on wall time until the next frame's seek and was anchored wherever it had got to, so CLI renders and in-browser exports of the same input, seed and settings gave different frames (50 to 60 of 186 in one case).
