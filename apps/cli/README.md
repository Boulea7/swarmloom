# swarmloom (CLI)

Render any file or web page that SwarmLoom supports to a video of the cursor swarm building it, with sound. Frames are captured one at a time on a virtual clock, so the video does not depend on how fast the machine is, and the same seed gives the same frames.

```bash
npx swarmloom render README.md -o readme.mp4
npx swarmloom render https://example.com --format webm --speed 2
npx swarmloom render deck.pptx -o deck.gif --fps 15 --width 960 --height 540
npx swarmloom doctor
```

## Requirements

- Node.js 20 or newer.
- A Chromium-based browser. The CLI never downloads one by itself. The recommended one is Chrome Headless Shell at the revision the installed `playwright-core` pins, so every machine renders the same frames: `npx playwright@<playwright-core version> install chromium-headless-shell` (`swarmloom doctor` prints the exact command). The CLI looks in this order: `--chrome`, `SWARMLOOM_CHROME`, Chrome Headless Shell in Playwright's browser cache (`PLAYWRIGHT_BROWSERS_PATH` is honoured), an installed Chrome, Chromium, Edge or Brave (`CHROME_PATH`, Chromium commands on `PATH` on Linux, the default install locations on Windows, macOS and Linux; snap packages last), then Playwright's full Chromium build.
- ffmpeg 4 or newer for MP4, WebM, GIF and WebP. SwarmLoom does not ship ffmpeg; it uses the one on the machine, in this order: `--ffmpeg`, `SWARMLOOM_FFMPEG`, `ffmpeg` on `PATH` (older builds are skipped), then an `ffmpeg-static` package only if you installed one yourself. Without ffmpeg, `--format png-seq` still works and writes PNG frames plus `audio.wav`; a plain `swarmloom render <file>` with no `-o` or `--format` falls back to it with a warning.

`swarmloom doctor` shows what was found, which output formats the ffmpeg build can encode, and how to fix anything missing.

## Commands

| Command | What it does |
| --- | --- |
| `render <file\|url>` | Renders to `mp4` (H.264 + AAC, faststart), `webm` (VP9 + Opus), `gif` (palettegen/paletteuse), `webp` (animated) or `png-seq` (PNG frames + WAV). |
| `snapshot <url\|file.html>` | Opens the page headless and writes its Blueprint JSON (`-o -` for stdout). Local files open with their scripts turned off and get the same network rules as `render`: only the assets next to them, plus `https:` images and fonts. |
| `serve` | Serves the bundled Studio on `127.0.0.1` (random free port unless `--port`); `--open` opens it. |
| `formats` | Lists the supported input formats (`--json` for scripts). |
| `doctor` | Checks Node.js, the browser, ffmpeg and the bundled pages. |

Every command has `--help`. Common `render` options: `--width`/`--height` (CSS px, default 1280x720), `--scale` (device pixel ratio of the frames), `--fps` (default 30), `--agents`, `--speed`, `--seed`, `--theme`, `--labels`, `--overlays` (`minimal` or `none` hides editing marks such as size badges and guide lines), `--finale`, `--tail` (hold after the build, ms: the finale, then the page goes live and its own animations play), `--no-live` (keep the finale instead), `--no-sound`, `--no-remote`, `--max-duration` (seconds, default 120; the video stops there even if the build is not done) and `--quiet`.

For repeatable takes timed to music: `--duration` (exact length in seconds, keeps capturing after the build), `--bpm` (tempo the placement notes snap to), `--cue <at>:<action>` (pause, resume, finish or live at a time in seconds, ms or beats; repeatable), and the evidence outputs `--audio-out` (WAV), `--events-out` (sound log JSON on the frames' clock) and `--manifest-out` (arguments, input and blueprint hashes, program versions, fonts and per-frame PNG hashes; output paths relative to the manifest, no working directory, URL credentials and queries redacted).

Progress goes to stderr: a bar with the remaining time on a terminal, a line per quarter otherwise. Ctrl+C stops the render, closes the browser, stops ffmpeg and deletes temporary files; a second Ctrl+C quits at once. The CLI only ever stops processes it started.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Usage error: bad option, missing or unsupported input |
| 2 | Missing dependency: no browser, no usable ffmpeg or encoder, or a bundled page is missing |
| 3 | Render failure: the page, the browser or ffmpeg failed |
| 130 | Interrupted with Ctrl+C |

## How it works

`render` serves the render page of `@swarmloom/export` from a loopback port, opens it in the browser with Playwright at the requested viewport and scale, and calls its `init` once. Each frame is a `step(1000 / fps)` on the page's virtual clock followed by a CDP `Page.captureScreenshot`; frames are piped into ffmpeg with backpressure. After the last frame the page renders the sound log offline to WAV, and ffmpeg muxes it in at the exact video length. Web pages are captured live in the browser first (the snapshot script is injected into the page, after its CSS animations are stopped at a fixed pose) and played as a Blueprint.

While rendering, the render page only loads files from the CLI's own loopback server: the page itself, the input, and the images, fonts, style sheets, media and 3D model parts next to a local input file (published under a random path for that one render). An HTML file uses the images and fonts next to it; its `<link>` style sheets are left out, so keep its CSS in `<style>`. `https:` images and fonts the input links to are fetched without a `Referer`; `--no-remote` turns that off. Scripts, style sheets, data requests and plain-`http:` files from other sites are always blocked; `--verbose` lists each blocked request.

Only `playwright-core` is installed with the CLI. The render page, the snapshot script and Studio are bundled into `dist/` at build time (`pnpm build` in a source checkout). `pnpm -F swarmloom build` alone rebuilds the render page first when the sources it was built from changed (it compares `packages/export/dist/render.sources.json`), so it never ships a page built from older code. For development, `SWARMLOOM_RENDER_DIR`, `SWARMLOOM_STUDIO_DIR` and `SWARMLOOM_SNAPSHOT_BUNDLE` point the CLI at other copies.

License: MIT.
