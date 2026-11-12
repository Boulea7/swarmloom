---
"@swarmloom/export": patch
---

Cancelling an in-browser export now stops it at once while the hidden export frame is still loading or loading the input. Before, `exportVideo` noticed the signal only after the frame had loaded and its `init()` had finished, so the frame kept fetching and parsing in the background (up to the 60 s start timeout) after Studio already showed "Export cancelled." and allowed a new export. The frame is now removed as soon as the signal aborts.
