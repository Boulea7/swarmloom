---
"@swarmloom/adapter-markdown": patch
"@swarmloom/adapter-html": patch
---

Markdown follows its image policy in raw HTML too. With `remoteImages: false` or `network: "none"`, inline styles, `background` attributes, video posters and SVG `<image>`/`<feImage>` no longer load remote images, and video and audio files are never loaded. Plain `http:` images load only from a loopback base such as the CLI's server, as in adapter-html. adapter-html now exports `localOrigin`.
