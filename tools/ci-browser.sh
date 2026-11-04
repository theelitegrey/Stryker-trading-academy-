#!/bin/bash
# Run browser suites for CI (site-checks.yml) or by hand: tools/ci-browser.sh <suite.js> [<suite.js> ...]
# Starts tools/tests/chart-dev-server.mjs on a free-ish port, runs each suite with screenshots in out/<suite>/,
# keeps going after a failure, prints a summary, exits 1 if any suite failed, stops the server by PID.
cd "$(dirname "$0")/.." || exit 2
PORT=${CI_PORT:-8031}
node tools/tests/chart-dev-server.mjs "$PORT" >out-dev-server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 40); do curl -sf "http://127.0.0.1:$PORT/assets/version.json" >/dev/null && break; sleep 0.25; done
export CHART_BASE="http://127.0.0.1:$PORT" STRYKER_TEST_BASE="http://127.0.0.1:$PORT"
bad=()
for s in "$@"; do
  n=${s%.js}; n=${n%.mjs}; mkdir -p "out/$n"
  echo "::group::$n"
  if timeout "${SUITE_TIMEOUT:-420}" node "tools/tests/$s" "out/$n"; then echo "PASS $n"; else echo "FAIL $n"; bad+=("$n"); fi
  echo "::endgroup::"
done
echo "== summary: ${#bad[@]} failed ${bad[*]}"
[ ${#bad[@]} -eq 0 ]
