#!/bin/sh
# Rebuild assets/zs-editor/cm6.js (vendored CodeMirror 6, MIT). Run from the repo root; needs npm + network.
# Pin the versions named in the bundle's first line, bump them only on purpose.
set -e
T=$(mktemp -d); cp tools/zs-editor/cm6-entry.js "$T/entry.js"; cd "$T"
npm init -y >/dev/null
npm i --no-audit --no-fund @codemirror/state@6.7.6 @codemirror/view@6.43.15 @codemirror/language@6.13.1 @codemirror/commands@6.11.1 \
  @codemirror/autocomplete@6.20.4 @codemirror/lint@6.9.7 @codemirror/search@6.7.2 @lezer/highlight@1.2.5 esbuild >/dev/null
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=none --outfile=cm6.js
cd - >/dev/null
HEAD=$(head -1 assets/zs-editor/cm6.js)
{ echo "$HEAD"; cat "$T/cm6.js"; } > assets/zs-editor/cm6.js
rm -rf "$T"; echo "rebuilt assets/zs-editor/cm6.js"
