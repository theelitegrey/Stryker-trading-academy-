#!/usr/bin/env bash
# Launch the "Connect your AI to ZoroCharts" Worker deploy from this server, after the branch is merged to main.
# The deploy itself runs in GitHub Actions (.github/workflows/deploy-ai-agent.yml), because the Cloudflare token lives only
# in the repo's GitHub secrets: nothing secret is on this server or in the repo. This script only starts that workflow with
# the logged-in gh CLI and waits for it, so it can run as a detached systemd unit:
#   systemd-run --unit=tz-deploy-ai-agent --collect -p WorkingDirectory=/root/projects/stryker-trading-academy \
#     /bin/bash tools/deploy-ai-agent.sh
#   journalctl -u tz-deploy-ai-agent -f
# Order: run this first (Worker + AI_AGENT binding), then the normal site deploy so the binding reaches the Pages Functions.
# Rollback: see the header of .github/workflows/deploy-ai-agent.yml.
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch -q origin main
if ! git cat-file -e origin/main:workers/ai-agent/wrangler.jsonc 2>/dev/null; then
  echo "workers/ai-agent is not on origin/main yet; merge hermes/w-aiagent first" >&2; exit 1
fi
gh workflow run deploy-ai-agent.yml --ref main
sleep 8
RUN=$(gh run list --workflow deploy-ai-agent.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')
echo "run $RUN: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions/runs/$RUN"
gh run watch "$RUN" --exit-status
