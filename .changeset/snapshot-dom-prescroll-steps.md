---
"@swarmloom/snapshot-dom": patch
---

`prescroll` waits until each step has been rendered before it scrolls on, so intersection observers and lazy images see every position. Content that comes into view only at the first step (reveal-on-scroll cards just below the fold) used to stay hidden.
