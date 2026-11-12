---
"@swarmloom/export": patch
---

In-browser exports draw a video's poster until it plays, and a paused video with `controls` gets a likeness of Chromium's control bar (on the player's dark backdrop when there is no picture) instead of a white hole. A video from another site that cannot be read back is still left blank, now with a warning that the export dialog counts.
