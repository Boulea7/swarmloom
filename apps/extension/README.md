# @swarmloom/extension

The SwarmLoom browser extension. Click the toolbar button (or press Alt+Shift+W) and a swarm of
cursors rebuilds the page you are on, then hands the real page back. Click again, or press Esc, to
stop. There is no popup.

- Context menu (where the browser has one): rebuild this page, rebuild this element, open a
  linked PDF/DOCX/Markdown/SVG/image/3D file, or the current PDF, in Studio.
- Pages an extension cannot script (`chrome://`, `about:`, web stores, the PDF viewer, local files
  without access): a badge with the reason, plus a notice tab with three next steps: open in
  Studio, import a file, copy the link. Never a silent failure.
- Leaving or changing the page (route change, back/forward, bfcache) ends the swarm and restores
  the page.
- Options page: speed, cursors, labels, theme, sound and sound pack, volume, finale, reduced motion,
  language. Stored in `storage.local` and mirrored to `storage.sync` where it exists.
- Welcome page on install, with a live `<swarm-loom>` demo, pin instructions for this browser and
  a bundled demo page.
- Languages: en, zh_CN, zh_TW, ja, ko, es, fr, de.

Permissions: `activeTab`, `scripting`, `storage` and, where menus exist, `contextMenus`. Hosts are
only requested one origin at a time, when the bundled Studio must fetch a linked file. Nothing is
collected (`data_collection_permissions: none` on Firefox).

## Packages

One source tree, four packages, built with esbuild and a small manifest generator
(`scripts/targets.mjs`, `scripts/manifest.mjs`):

| Target | Output | Background | Notes |
| --- | --- | --- | --- |
| `chrome` | `dist/chrome`, `dist/chrome.zip` | MV3 service worker | Chrome 116+, also Brave, Opera, Vivaldi |
| `edge` | `dist/edge`, `dist/edge.zip` | MV3 service worker | Same code, own store listing |
| `firefox` | `dist/firefox`, `dist/firefox.zip` | MV2 event page | One XPI for Firefox 140+ desktop and Firefox for Android 142+ (`gecko` + `gecko_android`), id `swarmloom@boulea7.github.io` |
| `safari` | `dist/safari`, `dist/safari.zip` | MV3 service worker | Input for the Xcode container app (macOS, iOS, iPadOS) |

Features are decided twice: at build time per target (`src/shared/capabilities.ts`) and at run
time by probing the API about to be used (Safari on iOS and Firefox for Android have no context
menus or shortcuts, so everything is also reachable from the toolbar button and the in-page
toolbar). The user agent is never sniffed.

The content script (`swarm.js`) is snapshot-dom plus core, injected on demand. Format adapters are
not bundled: documents open in Studio. When a Studio build made with `STUDIO_TARGET=extension`
exists (`apps/studio/dist-extension`, `--studio <dir>` or `SWARMLOOM_STUDIO_DIR`), it is copied in
as `studio/`; otherwise Studio links go to the hosted Studio. Brand icons come from
`assets/brand/icon-<size>.png`, with generated placeholders until they exist.

## Commands

```sh
pnpm -F @swarmloom/extension build             # all targets + zips
node scripts/build.mjs --target firefox        # one target (comma-separated list allowed)
pnpm -F @swarmloom/extension check:package     # permissions, CSP, no remote code, zip = folder, size budget
pnpm -F @swarmloom/extension lint:firefox      # web-ext lint dist/firefox
pnpm -F @swarmloom/extension build:amo-source  # dist/firefox-amo-source.zip for AMO review
node scripts/amo-source.mjs --verify           # rebuild from that zip in a temp folder, compare hashes
pnpm -F @swarmloom/extension package:safari    # macOS + Xcode: Xcode project in build/safari
pnpm -F @swarmloom/extension test:e2e          # Chromium end-to-end test (see below)
```

Zips are reproducible: sorted entries, fixed timestamps (`SOURCE_DATE_EPOCH` when set), output
independent of the working directory. A rebuild needs the same Node major version and the locked
dependencies.

`scripts/safari-package.sh` uses `safari-web-extension-packager` and falls back to
`safari-web-extension-converter`, with `--project-location build/safari --copy-resources --swift
--no-open --no-prompt --force`; extra arguments such as `--app-name` and `--bundle-identifier` pass
through. Signing and store upload need the owner's Apple Developer account.

## Loading it locally

- Chrome / Edge: `chrome://extensions` (or `edge://extensions`), Developer mode, Load unpacked,
  pick `dist/chrome` or `dist/edge`.
- Firefox: `about:debugging#/runtime/this-firefox`, Load Temporary Add-on, pick
  `dist/firefox/manifest.json`. Android: `web-ext run -t firefox-android` (see web-ext docs).
- Safari: build the Xcode project with `package:safari`, run it, then enable the extension in
  Safari settings (allow unsigned extensions in the Develop menu for local builds).

## Tests

- Unit (`test/*.test.ts`, happy-dom): manifests per target, locales, zip and audit, background
  controller on a fake API, content session lifecycle, shared helpers.
- Browser (`test/*.browser.test.ts`, Chromium): media-only poster capture, element tracker,
  overlay UI.
- End-to-end (`test/e2e/extension.e2e.mjs`): loads `dist-e2e/chrome` into Chromium (persistent
  context, `--headless=new`, `--load-extension`), drives the service worker through the test hook
  of the `--e2e` build (`__swarmloomTest`, never in store packages; the audit checks it), checks
  the restricted-page notice, the toggle, and a full rebuild to `done`, go live and a byte-identical
  page. Set `SWARMLOOM_CHROME` to Chromium or Chrome for Testing; branded Chrome ignores
  `--load-extension`.

License: MIT.
