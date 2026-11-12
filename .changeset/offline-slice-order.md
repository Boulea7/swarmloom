---
"@swarmloom/core": patch
---

Exported soundtracks no longer play a sound late when a note before it snapped past one of the 2 s scheduling slices: the sounds after that note used to wait for the next slice and could start up to a few hundred ms late (more at slow tempos).
