#!/bin/sh
# 3-slot Chrome semaphore: run a command holding one of /tmp/stryker-chrome.lock.{0,1,2}.
# Usage: tools/chrome-slot.sh [-w seconds] cmd args...   (default wait 3600 s)
W=3600; [ "$1" = "-w" ] && { W=$2; shift 2; }
END=$(( $(date +%s) + W ))
while :; do
  for i in 0 1 2; do
    exec 9>"/tmp/stryker-chrome.lock.$i"
    if flock -n 9; then exec "$@"; fi   # fd 9 stays open across exec and holds the lock
    exec 9>&-
  done
  [ "$(date +%s)" -ge "$END" ] && { echo "chrome-slot: timed out waiting for a slot" >&2; exit 1; }
  sleep 1
done
