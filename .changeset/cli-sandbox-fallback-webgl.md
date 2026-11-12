---
"swarmloom": patch
---

Where the browser's sandbox cannot start and the CLI runs it without one, web pages given to `render` or `snapshot` no longer get WebGL or WebGPU, which ran on SwiftShader in a GPU process without a sandbox; 3D models rendered from files keep it. The warning now shows under `--quiet` too, and the new `--require-sandbox` option makes `render` and `snapshot` fail there instead.
