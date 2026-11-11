---
title: FAQ and troubleshooting
description: Fix page permissions, sound, format, performance, export and platform issues in SwarmLoom.
---

# FAQ and troubleshooting

## Pages and permissions

### Why does the toolbar icon do nothing?

Check that the current page is an ordinary web page. Content scripts cannot be injected into `chrome://`, browser stores, other extension pages, reader mode, `view-source:` or built-in PDF viewers.

Use **Open in Studio** from the menu, or download and import the original file. Enterprise policy can also restrict specific sites.

### Why can't the extension rebuild a local `file://` page?

Chromium requires separate file-URL access. Enable it in the extension's details and retry.

If you do not need the live page DOM, dropping the file into Studio is simpler and needs no file-URL permission.

### Why won't Studio open a URL?

Common causes are CORS, mixed content, authentication, a broken link or a server that disallows browser reads. Knowing a URL does not grant permission to read it.

Use the extension in the original tab when authenticated state is required. Never submit cookies to a third-party service. A public file can also be downloaded and imported locally.

### Why can't the built-in PDF viewer be rebuilt in place?

The browser's PDF viewer is a restricted page whose DOM is unavailable to the extension. Open the original PDF in Studio or import the file directly.

### Why won't a remote example open offline?

Offline caching covers the app shell and modules, examples and resources already cached. Installing the PWA does not automatically make remote URLs, unused adapters or external fonts available offline.

Open the required format online once, or use a local file.

## Playback and sound

### Why is there no sound?

Browsers usually require a user gesture before starting an AudioContext. Click **Tap for sound** or the sound button, then check:

- Sound is enabled in the toolbar;
- The system, tab and PWA are not muted;
- Master volume is above 0;
- The selected pack is not intentionally silencing keys.

Blocked autoplay does not affect visuals or export.

### Why is video, WebGL or a cross-origin iframe only a snapshot or placeholder?

Those regions cannot always be decomposed into safe text, boxes and paths. SwarmLoom uses a snapshot or labelled media layer rather than executing original page scripts to imitate a rebuild.

### Can I build only the current part of a long page?

Use `follow: "scroll"` for manual control, or rebuild only a selection through the extension. `tour` follows build progress automatically, while `none` fixes the viewport.

### How do I reduce animation?

Enable the operating system's reduced-motion preference and keep `reducedMotion: "auto"`. This path uses quick cross-fades and skips flocking and camera orbit.

## Formats and content

### Why do DOCX page counts or line breaks differ from Word?

Browser HTML layout is not Word's live pagination engine. Without reliable pagination information, SwarmLoom uses continuous layout.

Export a PDF from Word when exact page positions matter.

### Why does legacy DOC contain only simplified text?

The first DOC pipeline targets body text and paragraphs, not complex tables, floating images, exact fonts or pagination. Convert to DOCX for richer structure, or PDF for visual fidelity.

### Why isn't a scanned PDF typed character by character?

A scanned page often contains only an image and no text items. SwarmLoom reveals regions rather than inventing a text layer. OCR is not automatic in the first release.

### Why is a spreadsheet result blank or shown as an expression?

SwarmLoom does not execute formulas; it displays expressions and cached values stored in the file. Recalculate and save in the relevant spreadsheet application before importing. Macros, external links and network queries do not run.

### Why does OBJ or glTF lose materials or fail to open?

SwarmLoom reads only the one file and never loads companion files: a `.gltf` that references external `.bin` files or textures is rejected, so export a GLB or a glTF with embedded data; OBJ MTL materials and textures are not read and a palette is used instead.

## Performance and export

### What should I change first when playback stutters?

Use `auto` or fewer cursors, disable the halo finale, reduce viewport and DPR, and check for huge images or models. See [Performance](./performance) for details.

Higher speed shortens the run but does not necessarily reduce frame cost.

### Why is Export absent or recording unsuccessful?

The browser may lack Region Capture or the required MediaRecorder capabilities. Use the CLI command shown by Studio instead of trying to assemble video from screenshots.

### Why can't the CLI find Chrome or ffmpeg?

Run:

```bash
swarmloom doctor
```

Then specify the tools explicitly:

```bash
swarmloom render ./demo.md -o demo.mp4 \
  --chrome /path/to/chromium \
  --ffmpeg /path/to/ffmpeg
```

`SWARMLOOM_CHROME` and `SWARMLOOM_FFMPEG` are also supported. CLI subcommands are still being implemented; the interface above is planned.

### Why do compressed bytes differ with the same seed?

Encoder versions, threads and platforms can change MP4/WebM bytes. Deterministic validation compares raw frames and PCM, not compressed-file hashes.

Also fix the input, browser, fonts, viewport, DPR, adapters, plugins and CLI version.

### Can I install an extension or the full Studio on a watch?

That is not promised. watchOS/Wear OS has no general SwarmLoom extension route. The planned alternatives are the `?watch=1` tiny player, or MP4, animated WebP and stills exported on another device.

## Safari

### Why can't Safari install the ZIP directly?

A Safari Web Extension must live inside a container app. Follow the [installation guide](./install#safari-build-from-source) to generate, sign and run the app for each operating system in Xcode.

### Why does an unsigned extension disappear after restart?

macOS Safari's unsigned-extension allowance is a temporary development path. Regular use needs appropriate signing; outside-store macOS distribution also involves Developer ID and notarisation, while TestFlight/App Store requires Apple Developer Program membership.

## Still stuck?

Search [GitHub Issues](https://github.com/Boulea7/swarmloom/issues) and [Discussions](https://github.com/Boulea7/swarmloom/discussions) first. Include in a new report:

- SwarmLoom, browser and operating-system versions;
- Input format and a redacted minimal sample;
- Complete reproduction steps;
- Expected and actual results;
- Console errors, screenshots or a short recording.

Do not upload passwords, cookies, private documents or other sensitive data. Use the [private security-reporting route](https://github.com/Boulea7/swarmloom/blob/main/SECURITY.md) for vulnerabilities.
