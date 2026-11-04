#!/bin/bash
# Wait for the site-checks run of a commit. Usage: tools/ci-wait.sh <sha> [timeout-seconds, default 900]
# Exit 0 = success, 1 = failed (prints failing jobs + run URL), 2 = timeout / no run found. Needs `gh` logged in.
SHA=${1:?usage: ci-wait.sh <sha> [timeout]}; MAX=${2:-900}; END=$(( $(date +%s) + MAX ))
while [ "$(date +%s)" -lt "$END" ]; do
  J=$(gh run list --commit "$SHA" -w site-checks --json databaseId,status,conclusion,url --limit 1 2>/dev/null)
  ID=$(echo "$J" | jq -r '.[0].databaseId // empty'); ST=$(echo "$J" | jq -r '.[0].status // empty')
  if [ -n "$ID" ] && [ "$ST" = completed ]; then
    CON=$(echo "$J" | jq -r '.[0].conclusion'); URL=$(echo "$J" | jq -r '.[0].url')
    if [ "$CON" = success ]; then echo "site-checks OK $URL"; exit 0; fi
    echo "site-checks $CON $URL"; echo "failing jobs:"
    gh run view "$ID" --json jobs -q '.jobs[] | select(.conclusion!="success" and .conclusion!="skipped") | "  - " + .name + " (" + .conclusion + ")"'
    exit 1
  fi
  sleep 10
done
echo "ci-wait: timed out after ${MAX}s waiting for site-checks on $SHA" >&2; exit 2
