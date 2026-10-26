#!/bin/sh
# Backtest-on-Vela full matrix. usage: sh run-matrix.sh  -> $TMPDIR/matrix.log
LOG=${TMPDIR:-/tmp}/matrix.log; : > $LOG
for cfg in "phone ui=2" "phone ui=1" "phone412 ui=2" "phone412 vela=0.6" "phone vela=0.6&ui=2" "desktop ui=2" "desktop ui=1" "desktop vela=0.6"; do
  echo "=== $cfg" >> $LOG
  timeout 280 systemd-run --user --scope -p MemoryMax=1000M flock /tmp/stryker-chrome.lock node bt-vela-full.js $cfg 2>&1 | grep -v "Running\|^\s*at \|screenshot" >> $LOG
done
echo DONE >> $LOG
