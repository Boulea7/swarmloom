---
"swarmloom": patch
"@swarmloom/export": patch
---

The CLI build no longer ships a stale render page. The render page build stamps the hashes of the files it was built from, and `pnpm -F swarmloom build` rebuilds the page first when any of them changed.
