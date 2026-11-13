---
"@swarmloom/adapter-markdown": patch
---

Image references that name another host in the browser's reading, such as `\\host/a.png`, `/\host/a.png` or a scheme split by a tab, now follow the image policy without a `baseUrl` too: they count as `https://host/a.png`, so `remoteImages: false` and `network: "none"` block them. The one exception is the loopback origin of a plain-http `baseUrl` (the CLI's local server): there they stay that local `http:` URL, which loads with remote images on or off, like other images from that server. `file:` images with a host (network shares) are refused. The docs no longer claim that posters, SVG images and CSS backgrounds load without a referrer: only `<img>` sets `referrerpolicy`, the others follow the host page's policy.
