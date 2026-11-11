---
"@swarmloom/export": patch
---

Exporting in the browser now follows the web images and fonts setting when it embeds resources in each frame. Before, the frame rasteriser fetched every image and font URL it found from the exporting page, whose policy allows wider connections, so with the setting off it still requested remote images and fonts the page had blocked (a `background` attribute, `image-set("https://…")`, an escaped `url(`), and with it on it also fetched `http:` URLs. It now fetches only data:, blob:, the page's own origin and, when the setting is on, https: URLs; anything else is drawn from its loaded element or left blank, with a warning.
