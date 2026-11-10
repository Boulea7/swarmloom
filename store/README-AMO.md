# SwarmLoom: source code and build steps for AMO review

This archive is the SwarmLoom repository at the commit the Firefox package was built from
(`git archive` of the release tag). The extension code is bundled with esbuild and the bundled Studio page
with Vite, so the files in the package are generated. All build tools are open source and run locally.

## Build environment

- Release builds run on GitHub Actions `ubuntu-latest` (x86_64).
- Node.js 22.12 or later. The release build uses the version in `.nvmrc` (22).
- pnpm, at the exact version in the `packageManager` field of `package.json`, started through Corepack.
  On Node.js 25 or later, where Corepack is no longer bundled, install it first: `npm install -g corepack`.
- No network access is needed after `pnpm install`. No browser download is needed.

## Build

Run from the root of this archive:

```sh
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile
pnpm build:extension
```

The unpacked Firefox build is written to `apps/extension/dist/firefox/`.

## Compare with the uploaded package

From the root of this archive, after the build:

```sh
mkdir -p /tmp/swarmloom-amo
unzip -q -o /path/to/swarmloom-firefox-<version>.zip -d /tmp/swarmloom-amo
diff -r /tmp/swarmloom-amo apps/extension/dist/firefox
```

The package is made by `scripts/release/pack-extension.mjs`, which copies every file of
`apps/extension/dist/firefox/` except dotfiles and source maps (`*.map`); `diff` may list those as
only present in the build folder. All other files should be identical; if they are not, please tell us
through the issue tracker linked below.

## Where the code lives

- `apps/extension/`: background script, content script entry, options and welcome pages, manifest generator.
- `apps/studio/`: the Studio page bundled into the extension as `studio.html`.
- `packages/`: the shared engine (`core`), page snapshot (`snapshot-dom`), file format adapters and the
  `<swarm-loom>` element.

Licence: MIT. Questions: https://github.com/Boulea7/swarmloom/issues
