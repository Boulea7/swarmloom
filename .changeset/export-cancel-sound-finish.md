---
"@swarmloom/export": patch
"@swarmloom/core": patch
---

Cancelling an in-browser export now also stops it at once while it makes the soundtrack or writes the file. Before, only the frame's start and the frames themselves listened to the signal: the sound log, the offline sound render, the sound encoding and the muxing ran on to the end in the background, the hidden export frame stayed in the page until then, and a new export started from Studio ran next to it. The export frame is now removed as soon as the signal aborts, the writer stops encoding and muxing (also when its encoder was already finalizing), and `renderOffline()` takes a `signal` that rejects at once and leaves only silence to render.
