#!/usr/bin/env bash
# Wraps dist/safari into an Xcode project (macOS, iOS and iPadOS app targets) under build/safari.
#
# Prefers `safari-web-extension-packager` (Xcode 26+) and falls back to the older
# `safari-web-extension-converter`. Requires macOS with Xcode; run `pnpm build` (or
# `node scripts/build.mjs --target safari`) first. Extra arguments are passed to the tool, e.g.
#   scripts/safari-package.sh --app-name SwarmLoom --bundle-identifier io.github.boulea7.swarmloom
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="${SAFARI_DIST:-$here/dist/safari}"
project="${SAFARI_PROJECT:-$here/build/safari}"

if [[ ! -f "$src/manifest.json" ]]; then
  echo "error: $src/manifest.json not found; build the safari target first" >&2
  exit 1
fi

tool=""
for candidate in safari-web-extension-packager safari-web-extension-converter; do
  if xcrun --find "$candidate" >/dev/null 2>&1; then
    tool="$candidate"
    break
  fi
done
if [[ -z "$tool" ]]; then
  echo "error: neither safari-web-extension-packager nor safari-web-extension-converter is available (install Xcode)" >&2
  exit 1
fi

xcodebuild -version 2>/dev/null || true
echo "using $tool ($(xcrun --find "$tool"))"

xcrun "$tool" "$src" \
  --project-location "$project" \
  --copy-resources \
  --swift \
  --no-open \
  --no-prompt \
  --force \
  "$@"

echo "Xcode project written to $project"
