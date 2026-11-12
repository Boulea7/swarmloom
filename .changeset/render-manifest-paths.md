---
"swarmloom": patch
---

`render --manifest-out` no longer records absolute paths in `argv` and `input.arg`: input and output files are written relative to the manifest (a file neither in its folder nor in a folder above it by name only), `--chrome` and `--ffmpeg` by program name, as the outputs and programs already were.
