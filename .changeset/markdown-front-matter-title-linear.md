---
"@swarmloom/adapter-markdown": patch
---

A front matter `title:` with a long run of spaces inside no longer takes time that grows with the square of the run (100k spaces took 25 s): the title is now read in linear time, with the same result.
