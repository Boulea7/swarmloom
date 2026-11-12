---
"@swarmloom/core": minor
"@swarmloom/adapter-terminal": patch
---

Terminal replays keep the cursors off the text. A cursor watching output waits right of the text above the output, idle cursors rest in the free space right of the lines (or on blank rows), and the typing cursor no longer shows a "typing" bubble over the line above the caret. A prompt printed right after a command is output, not typing, so the next typing step starts at the prompt. Plugins can choose where idle cursors rest with the new `Plugin.restSpot`.
