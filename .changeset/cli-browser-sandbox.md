---
"swarmloom": patch
---

The CLI starts Chromium with its sandbox on; it used to run every browser with `--no-sandbox`, so a web page given to `render` or `snapshot` ran its scripts in an unsandboxed renderer. Where the sandbox cannot start (as root, or with user namespaces turned off) the CLI falls back to running without it and warns, and `swarmloom doctor` reports it.
