# Store images

Images for the store listings go in this folder. The media work produces them; none exist yet.
`node scripts/release/check-store.mjs` reads the plan in `store/stores.yaml` (section `images`), checks the
size and alpha channel of every file present here and lists what is still missing
(`--require-images` turns missing files into errors).

Format: PNG or JPEG (`.png`, `.jpg` or `.jpeg`), sRGB, compressed.
App Store screenshots must not have an alpha channel; the checker rejects PNGs with alpha or `tRNS`.

| File (without extension) | Size (px) | Count | Used by |
| --- | --- | --- | --- |
| `en/screenshot-1` ... `en/screenshot-5`, `zh-CN/screenshot-1` ... | 1280 x 800 | 1 to 5 per language | Chrome (1-5), Edge (up to 6), AMO, Mac App Store (16:10) |
| `promo-small` | 440 x 280 | 1 | Chrome (required, not localized, avoid text), Edge small tile (optional) |
| `promo-marquee` | 1400 x 560 | 0 or 1 | Chrome marquee (optional), Edge large tile (optional) |
| `edge-logo` | 300 x 300 | 1 | Edge store logo (1:1, at least 128 x 128) |
| `en/iphone-1` ... `zh-CN/iphone-1` ... | 1206 x 2622 or 1179 x 2556 (portrait) | 1 to 10 per language | App Store, iPhone app |
| `en/ipad-1` ... `zh-CN/ipad-1` ... | 2064 x 2752 or 2048 x 2732 (portrait) | 1 to 10 per language | App Store, iPad app |

What to show (one idea per screenshot, real product frames only, no mock features):

1. A familiar page mid-rebuild, cursors with name tags placing blocks.
2. The same page finished, with the finale.
3. A document or PDF opened in SwarmLoom Studio.
4. The options page (speed, cursors, sound packs).
5. Light and dark theme side by side, or the right-click menu.

Screenshots must match the build being submitted and use original artwork (contracts/brand.md). Do not show
other companies' logos, private pages or personal data. The extension icons themselves come from
`assets/brand/` through the extension build; they are not duplicated here.
