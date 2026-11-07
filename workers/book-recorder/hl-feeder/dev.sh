#!/bin/sh
# Dev only: run the book-recorder Worker code locally (node:sqlite DO, 127.0.0.1:8790, CORS *) and the wallet-intel
# feeder posting live Hyperliquid data to it, so the chart UI can be built against real /hl-* answers before deploy.
# Uses a throwaway random secret (never the production one). Both stop by themselves after HL_DEV_HOURS (default 6):
# the dev feeder spends the same Hyperliquid per-IP budget as the production one, so never run both for long.
# Stop early: kill the two PIDs printed below.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dir=${HL_DEV_DIR:-${TMPDIR:-/tmp}/hl-dev}
mkdir -p "$dir"
umask 077
[ -f "$dir/secret" ] || python3 -c "import secrets; print(secrets.token_hex(24))" > "$dir/secret"
secs=$(( ${HL_DEV_HOURS:-6} * 3600 ))
HL_SECRET=$(cat "$dir/secret") HL_DB="$dir/dev.sqlite" nohup timeout "$secs" node "$here/../test/hl-local-server.mjs" 8790 --cors-any > "$dir/server.log" 2>&1 &
echo "server pid $!"
sleep 2
BOOK_RECORDER_URL=http://127.0.0.1:8790 BOOK_INGEST_SECRET=$(cat "$dir/secret") HL_STATE_FILE="$dir/state.json" nohup timeout "$secs" python3 "$here/hl_feeder.py" > "$dir/feeder.log" 2>&1 &
echo "feeder pid $!"
echo "dev URL http://127.0.0.1:8790/hl-meta (first data after ~1-2 min; logs in $dir)"
