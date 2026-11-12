# @swarmloom/studio

SwarmLoom Studio is the installable web app (PWA). Open or drop a file, paste text or enter a URL, watch the swarm build it, tune the settings and export a video. It is deployed to GitHub Pages under `/swarmloom/studio/`. Set `SWARMLOOM_STUDIO_BASE` to change the base path at build time, and run `pnpm dev:studio` from the repository root for local development.

## What it does

- **Home:** a drop zone, a file picker, paste (with a format choice; notebooks, asciicasts, patches, FreeMind maps, RTF and Lottie JSON are recognised by content), a URL field, and a gallery of every sample in the repository's `examples/` folder, copied in at build time with static thumbnails. Licence notes next to the samples (such as `examples/doc/SOURCES.md`) are copied too, without a tile.
- **Player:** a full-bleed inline stage, a scrubber (a seek slider on the player's time line when the player has `seek(t)`, a progress bar otherwise), a settings drawer (a bottom sheet on phones), export (a frame-exact video made in the page with WebCodecs, or the `swarmloom render` command for the same file), and share links that carry small text files inside the URL hash.
- **Layouts:** desktop, tablet, phone, foldables (two panes via Viewport Segments, refined by Device Posture when available) and a watch face.
- **PWA:** installable, a share target for files and text, an OS file handler, and a hand-written service worker. The worker installs on the first visit, not only when the app is installed: it caches the shell and, in the background, every format reader and the in-browser video exporter with the chunks they import (for PDF, only the pdf.js build this browser runs), so local files open and export offline in a tab as well. The worker's version hashes the content of every cached file, so a change to the page, the manifest or an icon alone still reaches installed copies.
- **Languages:** zh-CN, zh-TW, en, ja, ko, es, fr and de. Studio picks the browser language, and the settings can change it.

Files are read in the browser and never uploaded. Remote https images and fonts in documents load without a referrer; the "Load web images and fonts" setting turns them off. A Content-Security-Policy in `index.html` backs up the format readers: only Studio's own scripts run, and from the web only https images and fonts load, plus the file you open. With the setting off, `src/csp.ts` adds a stricter policy that also blocks web images and fonts; turning it back on asks for a page reload. Back and Forward reopen each entry's own local file while the tab keeps it (the last 8); older entries ask you to open the file again. Changing the language keeps a running build and anything typed on the home page.

## URL parameters

| Parameter | Meaning |
| --- | --- |
| `?example=<id>` | Open a bundled example. |
| `?src=<url>` | Open a remote file or page (http and https only). |
| `#d=<payload>` | Open a shared text file (base64url of deflate-raw JSON). |
| `?autoplay=1` | Start without waiting for the play button. |
| `?watch=1` | Watch face. Watch-sized screens (up to 320 x 400) switch to it on their own; a narrow window on a bigger screen and `?import=1` links keep the normal Studio. |
| `?round=1` | Round watch face: every control stays in the inscribed square. |
| `?import=1` | Highlight the file picker (sent by the extension). |
| `?key=<key>` | Read input the extension stored in `chrome.storage` (extension build). |
| `?inbox=<id>` | Read files shared to the installed app (service worker inbox). |
| `?launch=1` | Wait for files opened with the installed app (`file_handlers`). A file that cannot be read (empty, too large) returns to home with the reason. |
| `?from=bookmarklet` | Receive a page copy from the bookmarklet (`window.opener`). |
| `agents`, `speed`, `seed`, `labels`, `theme`, `finale`, `follow`, `motion`, `sound`, `pack`, `lang` | Settings for this visit only. |

## Keyboard

Press `?` for the full list. Studio keys: `O` open a file, `P` paste, `U` URL, `S` settings, `E` export, `Esc` back. Playback keys (`Space`, `1` to `3`, `M`, `T`, `R`, `L`) belong to the core player toolbar; a speed, sound or tour change made there becomes Studio's setting, so share links and exports use it. On the scrubber, arrows move 2%, `Page Up`/`Page Down` 10%, and `Home`/`End` jump to the ends.

## Build targets

| Command | Output |
| --- | --- |
| `pnpm -F @swarmloom/studio build` | Both targets below. |
| `pnpm -F @swarmloom/studio build:web` | `dist/`: the PWA with examples, manifest, icons and `sw.js`. |
| `pnpm -F @swarmloom/studio build:extension` (or `STUDIO_TARGET=extension`) | `dist-extension/studio.html`: relative paths, no service worker, no examples. Files arrive through `?src=` or `?key=`. |

App icons are drawn from the mark in `src/ui/mark.ts` at build time; no image files are checked in. The gallery picks up new files in `examples/` automatically. A new format also needs an entry in `src/formats-meta.ts` (test/formats-meta.test.ts keeps it in step with the `@swarmloom/formats` registry), and a name in the Studio catalog until core translates it. Formats whose adapter may be missing from a custom registry are marked `optional` there and stay hidden until the registry provides them. Lottie is one; the bundled registry includes it.

## Tests and screenshots

```sh
pnpm exec vitest run --project unit apps/studio/test
SWARMLOOM_CHROME=$HOME/bin/chromium pnpm exec vitest run --project browser apps/studio/test
SWARMLOOM_CHROME=$HOME/bin/chromium pnpm -F @swarmloom/studio screens
```

The browser tests and the screenshot page (`test/screens/`) mount the real UI with a fake player from `test/fakes.ts`, so they stay fast and deterministic. The `screens` script saves home, player, foldable and watch captures to `test/__screens__/`, which is not committed.
