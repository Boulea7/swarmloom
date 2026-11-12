---
"@swarmloom/adapter-markdown": patch
---

Image references that name another host in the browser's reading, such as `\\host/a.png`, `/\host/a.png` or a scheme split by a tab, now follow the image policy without a `baseUrl` too: they count as `https://host/a.png`, so `remoteImages: false` and `network: "none"` block them. `file:` images with a host (network shares) are refused.
