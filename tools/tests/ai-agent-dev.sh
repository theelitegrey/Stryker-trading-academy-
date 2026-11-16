#!/usr/bin/env bash
# Local stack for "Connect your AI to ZoroCharts" tests: the tz-ai-agent Worker on :8787 (DEV + fake member auth, loopback
# only, refused on tradezoro.com) and the site on :8788 with the AI_AGENT service binding. Ctrl-C / `ai-agent-dev.sh stop` ends both.
# Logs: $TMPDIR/ai-worker.log, $TMPDIR/ai-pages.log
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="${TMPDIR:-/tmp}"
W="npx --yes wrangler@4.158.0"
if [ -x "${WRANGLER:-}" ]; then W="$WRANGLER"; fi
stop() { pkill -f "wrangler.*dev --port 8787" 2>/dev/null || true; pkill -f "wrangler.*pages dev .* --port 8788" 2>/dev/null || true; }
if [ "${1:-}" = "stop" ]; then stop; exit 0; fi
stop; sleep 1
(cd "$ROOT/workers/ai-agent" && setsid nohup $W dev --port 8787 --ip 127.0.0.1 --var DEV:1 --var DEV_FAKE_AUTH:1 --var DEV_ORIGIN:http://127.0.0.1:8788 > "$T/ai-worker.log" 2>&1 &)
for i in $(seq 1 60); do curl -sf -m2 127.0.0.1:8787/.well-known/oauth-protected-resource >/dev/null && break; sleep 1; done
(cd "$ROOT" && setsid nohup $W pages dev . --port 8788 --ip 127.0.0.1 --service AI_AGENT=tz-ai-agent --compatibility-date 2026-10-01 > "$T/ai-pages.log" 2>&1 &)
for i in $(seq 1 90); do curl -sf -m2 127.0.0.1:8788/.well-known/oauth-authorization-server >/dev/null && break; sleep 1; done
curl -sf -m2 127.0.0.1:8788/.well-known/oauth-authorization-server >/dev/null && echo "ready: http://127.0.0.1:8788 (site) + :8787 (agent)" || { echo "stack did not start; see $T/ai-*.log"; exit 1; }
