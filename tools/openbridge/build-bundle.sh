#!/usr/bin/env bash
# Build the slim OpenBridge automation bundle used by ScadaCraft widgets.
#
# OpenBridge licensing: each release is AGPL-3.0 for 180 days, then also Apache-2.0.
# Only use a version whose 180-day change date has passed (or hold a commercial license).
# 1.0.0 was published 2026-04-16 with "license": "Apache-2.0" and is past its change date.
set -euo pipefail

OB_VERSION="${OB_VERSION:-1.0.0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../client/src/assets/lib/openbridge"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund "@oicl/openbridge-webcomponents@${OB_VERSION}" esbuild >/dev/null

cp "$HERE/entry.js" ./entry.js
npx esbuild entry.js --bundle --minify --format=iife --legal-comments=eof \
  --outfile="$OUT/openbridge-automation.min.js"

PKG="node_modules/@oicl/openbridge-webcomponents"
cp "$PKG/dist/openbridge.css" "$OUT/openbridge.css"
cp "$PKG/dist/NotoSans.ttf" "$OUT/NotoSans.ttf"   # font used by the components (SIL OFL 1.1)
echo "${OB_VERSION}" > "$OUT/VERSION"
echo "OpenBridge ${OB_VERSION} bundle written to $OUT"
