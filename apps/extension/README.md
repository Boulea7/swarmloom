# @swarmloom/extension

The SwarmLoom browser extension. One base Manifest V3 plus per-browser overrides produce unpacked builds for Chrome (also Brave and Opera), Edge, Firefox (desktop and Android) and Safari (`dist/<browser>/`, via `pnpm build` or `node scripts/build.mjs --browser firefox`); the Safari output is converted into an Xcode project with `safari-web-extension-converter` in CI.
