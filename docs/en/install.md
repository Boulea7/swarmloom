---
title: Install
description: Use SwarmLoom on Chrome, Edge, Firefox, Safari, PWAs, foldables and watches.
---

# Install

::: warning Release status
Studio is online and can be installed as a PWA. Store listings and signed extension packages have not been published, and extension features are still being implemented. The badge on each section shows whether a route is available, a development build or planned. Source packages are for development verification, not a claim of feature completeness.
:::

## Choose an entry point

| Environment | Route | Notes |
| --- | --- | --- |
| Chrome / Edge desktop | Manifest V3 extension | In-place page and selection rebuilding, plus Studio file import |
| Brave / Opera / Vivaldi desktop | Chromium package | Reuses the Chrome package, with per-browser compatibility checks |
| Firefox desktop and Android | One Firefox package (MV2 event page) | Desktop and Android share one AMO listing; regular installation requires Mozilla signing |
| Safari macOS / iOS / iPadOS / visionOS | Safari Web Extension inside a container app | Convert, sign and run with Xcode |
| Desktop / Android / iOS | Studio PWA | Files, text, URLs and examples; cannot inject into other tabs |
| Foldables | Extension or Studio | Dual-screen layouts enhance a working responsive fallback |
| watchOS / Wear OS | Tiny player or exported animation | No browser extension and no promise of full PWA support |

The committed targets are the Chrome/Edge, Firefox and Safari extensions and the Studio PWA. Brave, Opera and Vivaldi get compatibility checks only, and Orion (iOS/iPadOS) is experimental. Samsung Internet extensions need its developer programme first, and foldables and watches are experimental extras. Arc and Kiwi are not release targets.

## Build development packages

All browsers share one source tree. Build workspace dependencies, then generate the extension directories:

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm build
pnpm --filter @swarmloom/extension build
```

Artifacts are written to `apps/extension/dist/`: `chrome/`, `edge/`, `firefox/` and `safari/`. `firefox/` serves both desktop and Android; there is no separate Android package.

## Chrome <Badge type="warning" text="Development package" />

The release is planned for the Chrome Web Store. To load the development package:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/extension/dist/chrome/`.
5. Pin SwarmLoom, open a normal page and click its icon.

In-place rebuilding is unavailable on `chrome://`, the Chrome Web Store, other extension pages and the built-in PDF viewer. Access to `file://` pages requires a separate **Allow access to file URLs** setting. Dropping a file into Studio does not need that permission. Without it, clicking SwarmLoom on a local PDF opens Studio on its file picker; choose the same file there.

## Microsoft Edge <Badge type="warning" text="Development package" />

The release is planned for Microsoft Edge Add-ons. To load the development package:

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/extension/dist/edge/`.

The extension installation path on Edge Android still needs separate verification. Until then, only the Studio PWA is promised on that platform; desktop sideloading is not presented as a consumer route.

## Brave, Opera and Vivaldi <Badge type="warning" text="Compatibility testing" />

These browsers reuse `dist/chrome/`:

- Brave: open `brave://extensions`, enable Developer mode and load the unpacked directory.
- Opera: open `opera://extensions`, enable Developer mode and load the unpacked directory.
- Vivaldi: open `vivaldi://extensions`, enable Developer mode and load the unpacked directory.

A shared Chromium base does not guarantee identical behaviour. Permission prompts, audio unlock, toolbar behaviour and export need separate tests.

## Firefox desktop <Badge type="warning" text="Temporary debugging" />

The planned package is an MV2 event page with a stable Gecko ID; `browser_specific_settings` declares both `gecko` and `gecko_android`, and it is signed through AMO. Release and Beta Firefox cannot permanently install an unsigned XPI.

To load the development directory temporarily:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `apps/extension/dist/firefox/manifest.json`.

Temporary add-ons are removed when Firefox restarts. Changing signing preferences is not a substitute for release distribution.

## Firefox Android <Badge type="warning" text="Planned" />

Android uses the same Firefox package and the same AMO listing as desktop. Desktop shortcuts, context menus and window management are unavailable; actions move into the add-on menu and touch controls.

Regular installation still requires AMO signing. Development verification uses Mozilla's `web-ext`, ADB and a debug-enabled device. Use Studio PWA until real-device verification is complete.

## Safari: build from source <Badge type="warning" text="Development package" />

A Safari Web Extension must ship inside a container app. Safari cannot install the Chromium ZIP directly. Signed TestFlight and App Store builds are planned; testing on real devices is not done yet.

### Requirements

- macOS with a compatible Xcode release.
- Safari for Mac testing.
- Signing for physical iPhone, iPad or Apple Vision Pro installation.
- Apple Developer Program membership for device distribution, TestFlight and the App Store.

### Generate the Xcode project

After building the extension, run this from the repository root:

```bash
pnpm --filter @swarmloom/extension package:safari
```

The script wraps `apps/extension/dist/safari/` into an Xcode project under `apps/extension/build/safari/`. It uses `safari-web-extension-packager` from recent Xcode and falls back to the older `safari-web-extension-converter`. Arguments after the script name, such as `--app-name` or `--bundle-identifier`, are passed to that tool. The project gets copies of the files, so later source changes require another build and packaging pass.

### Run on each operating system

1. Open the generated project under `apps/extension/build/safari/` in Xcode.
2. Select a development team, adjust Bundle IDs if needed, and sign both the container app and Safari Web Extension targets.
3. Select the appropriate macOS, iOS, iPadOS or visionOS destination and run the container app. Simulators support unsigned development builds; physical devices require signing.
4. macOS: enable SwarmLoom in Safari's **Extensions** settings.
5. iOS / iPadOS: enable SwarmLoom in the system Safari extension settings and grant site access when prompted.
6. visionOS: enable it in the corresponding Safari extension settings. iPadOS uses the iOS container flow; visionOS uses a visionOS target.

Mobile Safari has no desktop context-menu or window-management APIs. Use file pickers, drag and drop, or system sharing for files. Safari extensions cannot read local files, so clicking SwarmLoom on a `file://` document opens Studio on its file picker. Safari's `storage.sync` should not be interpreted as cross-device synchronisation.

## Studio PWA <Badge type="tip" text="Online" />

[Studio](https://boulea7.github.io/swarmloom/studio/) works as a normal web app. Installation is optional; an installed app adds a standalone window and platform-dependent sharing and file entry points.

### Desktop Chromium

Open Studio in Chrome or Edge and use the install icon in the address bar. If it is absent, use **Install app** or **Install page as app** in the browser menu.

On macOS Safari 17 or later, use **File > Add to Dock**. Firefox desktop does not support manifest-based PWA installation; use a normal tab or bookmark.

### Android

Choose **Install app** or **Add to Home screen** in Chrome's menu. Depending on the browser, this creates a WebAPK or a browser-branded shortcut.

An installed PWA can register as a system share target where supported. Otherwise, use copy, paste and file selection.

### iOS / iPadOS

1. Open Studio in Safari.
2. Tap **Share**.
3. Choose **Add to Home Screen**.

iOS does not use Chromium's automatic installation prompt. Launching from the Home Screen provides a standalone window. Safari extensions and Home Screen web apps do not share the same permissions or site data by default.

## Foldables

No separate package is needed. Where the browser supports Viewport Segments, Studio splits into two panes and keeps content off the hinge. On a side-by-side dual screen, the home page puts the open actions on the left and the gallery on the right, and the player keeps the stage on the left with settings and dialogs on the right. On a stacked dual screen, the player sits above the hinge and settings and dialogs below it.

Viewport Segments is a Chromium feature, not a cross-browser baseline. Other browsers keep the ordinary responsive layout. Rotation and folding do not reseed the scene or alter the export timeline.

## Watches: honest substitutes

SwarmLoom does not provide a watch browser extension, and does not promise a general PWA, background playback or arbitrary page rebuilding on watches.

The alternatives are:

- Open Studio with `?watch=1` for the small watch player; watch-sized screens switch to it on their own. It keeps only playback, progress, the next example and **Open on phone**, which shows a QR code.
- The player shows a static poster first and plays muted. Add `?round=1` on a round face to keep every control inside the circle.
- Generate MP4, animated WebP or a still frame on a phone or desktop, then send that result to the watch.

On watchOS, web content is commonly opened from Messages or Mail links. Wear OS browser availability and installation vary by model and region. The watch player shows an already generated scene; it does not summon a swarm on the watch's current page.
