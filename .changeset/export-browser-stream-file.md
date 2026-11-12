---
"@swarmloom/export": patch
---

The in-browser export no longer keeps the whole video in script memory. Before, the muxer held every encoded frame until the soundtrack arrived, wrote the MP4 into one growing buffer and copied it once more into the Blob, so a 10-minute 1080p60 export peaked at about three times its file size (over 1 GB) and could crash a tab on a phone. Encoded frames now wait in `Blob` parts and the file is written into `Blob` parts as it is muxed, so script memory no longer grows with the video's length. The MP4 is still fast start: it reserves room for its index ahead of the media (a few dozen bytes per frame at most). The soundtrack is still rendered in one piece, as the CLI renders it.
